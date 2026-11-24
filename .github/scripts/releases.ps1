$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/release-config.ps1"

function Receive-Archive([string] $Url, [string] $Destination) {
    $address = $null
    if ($Url.Length -gt 16384 -or -not [uri]::TryCreate($Url, [UriKind]::Absolute, [ref] $address) -or $address.Scheme -cne 'https' -or $address.Fragment) { throw 'Dependency downloads require a direct HTTPS archive URL.' }
    & "$env:SystemRoot/System32/curl.exe" --fail --location --silent --show-error --retry 3 --connect-timeout 20 --max-time 600 --max-filesize 1073741824 --proto '=https' --proto-redir '=https' --output $Destination $Url
    if ($LASTEXITCODE) { throw "Could not download archive: $Url" }
}

function Expand-ModArchive([string] $Archive, [string] $Destination) {
    $prefix = [IO.Path]::GetFullPath($Destination).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $spellings = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
        $bytes = 0L
        if ($zip.Entries.Count -gt 200000) { throw 'The dependency archive contains too many entries.' }
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/').TrimEnd('/')
            $parts = $name.Split('/')
            if (-not $name -or @($parts | Where-Object { $_ -in @('', '.', '..') -or $_.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $_ -match '[. ]$|^(?i:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)' }).Count) { throw 'Unsafe dependency archive path.' }
            $parent = ''
            foreach ($part in $parts) {
                $parent += "/$part"
                $existing = $null
                if ($spellings.TryGetValue($parent, [ref] $existing) -and $existing -cne $parent) { throw 'Aliased dependency archive directory.' }
                $spellings[$parent] = $parent
            }
            $target = [IO.Path]::GetFullPath((Join-Path $Destination $name))
            if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not $names.Add($target) -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400)) { throw 'Aliased or linked dependency archive path.' }
            $bytes += $entry.Length
            if ($bytes -gt 1GB) { throw 'The dependency archive exceeds the 1 GiB extraction limit.' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
    $roots = @(Get-ChildItem -LiteralPath $Destination -Force)
    if ($roots.Count -ne 1 -or -not $roots[0].PSIsContainer -or $roots[0].Name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') { throw 'A dependency archive must contain one project folder.' }
    $root = $roots[0].FullName
    $manifestPath = Join-Path $root 'package-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Dependency '$($roots[0].Name)' has no package manifest. Rebuild and publish it with current YMB, then rerun this workflow."
    }
    if ((Get-Item -LiteralPath $manifestPath).Length -gt 16MB) { throw "Dependency '$($roots[0].Name)' has a package manifest larger than 16 MiB. Reduce its packaged files, then rebuild and publish it." }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
    if (-not $manifest.files -or $manifest.files -isnot [Collections.IDictionary]) { throw 'The dependency manifest has no checksums.' }
    $files = @(Get-ChildItem -LiteralPath $root -Recurse -Force -File | Where-Object FullName -CNE $manifestPath)
    if ($files.Count -ne $manifest.files.Count) { throw 'Dependency archive files differ from its manifest.' }
    foreach ($file in $files) {
        $relative = [IO.Path]::GetRelativePath($root, $file.FullName).Replace('\', '/')
        $digest = $manifest.files[$relative]
        if ($relative -cnotin $manifest.files.Keys -or $digest -notmatch '^[0-9a-fA-F]{64}$' -or (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ine $digest) { throw "Dependency checksum mismatch: $relative" }
    }
    $root
}

function Get-ModProjects([string] $Project, [string] $Work) {
    Import-Module powershell-yaml -RequiredVersion 0.4.12 -ErrorAction Stop
    [IO.Directory]::CreateDirectory($Work) | Out-Null
    $projects = [Collections.Generic.List[object]]::new()
    $active = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $folders = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $done = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $mods = Split-Path -Parent $Project
    function Visit-Project([string] $Root) {
        $configPath = Join-Path $Root 'config/ymb.mod.yaml'
        if ((Get-Item -LiteralPath $configPath).Length -gt 16MB) { throw 'Mod configuration exceeds the 16 MiB limit.' }
        $config = ConvertFrom-Yaml (Get-Content -LiteralPath $configPath -Raw)
        $name = Split-Path -Leaf $Root
        if ($config -isnot [Collections.IDictionary] -or $config.id -isnot [string] -or -not $config.id) { throw 'A project must declare its id in config/ymb.mod.yaml.' }
        if (-not $active.Add($config.id)) { throw 'Download dependencies contain a cycle.' }
        if (-not $ids.Add($config.id) -or -not $folders.Add($name)) { throw 'Different dependency URLs name the same project id or folder.' }
        if ($ids.Count -gt 64) { throw 'A release may contain at most 64 projects.' }
        if ($null -ne $config.dependencies -and $config.dependencies -isnot [Collections.IList]) { throw 'dependencies must be a list of archive URLs.' }
        foreach ($dependency in $config.dependencies) {
            if ($dependency.url -isnot [string]) { throw 'Each dependency needs a direct HTTPS archive URL.' }
            if ($done.Contains($dependency.url)) { continue }
            $attempt = Join-Path $Work ([guid]::NewGuid().ToString('N'))
            [IO.Directory]::CreateDirectory($attempt) | Out-Null
            $archive = Join-Path $attempt 'project.zip'
            Receive-Archive $dependency.url $archive
            try { $source = Expand-ModArchive $archive (Join-Path $attempt 'unpacked') }
            catch { throw "Could not prepare dependency '$($dependency.url.Split('?')[0])': $($_.Exception.Message)" }
            Visit-Project $source
            $destination = Join-Path $mods (Split-Path -Leaf $source)
            if (Test-Path -LiteralPath $destination) { throw "A dependency would overwrite an existing project: $destination" }
            Copy-Item -LiteralPath $source -Destination $destination -Recurse
            $projects[-1].root = $destination
            [void] $done.Add($dependency.url)
        }
        [void] $active.Remove($config.id)
        $projects.Add([pscustomobject]@{ name = $name; root = $Root })
    }
    Visit-Project ([IO.Path]::GetFullPath($Project))
    $projects.ToArray()
}

function Get-CheckedArchiveVersion([string] $Archive, [string] $Manifest) {
    Assert-ReleaseChecksum $Archive
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $names = @($Manifest, "./$Manifest")
        $entry = $null
        foreach ($name in $names) {
            $entry = $zip.GetEntry($name)
            if ($entry) { break }
        }
        if (-not $entry -or $entry.Length -gt 16MB) { throw 'Missing or oversized package manifest.' }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $version = ($reader.ReadToEnd() | ConvertFrom-Json).version } finally { $reader.Dispose() }
    } finally { $zip.Dispose() }
    if (-not $version) { throw 'The package manifest has no version.' }
    $version
}

function Get-ModReleaseConfig([string] $Project) {
    Import-Module powershell-yaml -RequiredVersion 0.4.12
    $mod = ConvertFrom-Yaml (Get-Content -LiteralPath (Join-Path $Project 'config/ymb.mod.yaml') -Raw)
    $overrides = @{}
    foreach ($key in $mod.release.Keys) {
        if ($key -cnotin @('version', 'url', 'include')) { $overrides[$key] = $mod.release[$key] }
    }
    Read-ReleaseConfig "$PSScriptRoot/../release.json" $overrides
}

function Get-RepositoryModReleasePlan([string] $Repository, $Config) {
    Import-Module powershell-yaml -RequiredVersion 0.4.12
    $branches = @(foreach ($branch in (Get-GitHubItems "repos/$Repository/branches")) {
        if (-not (Get-ReleaseBranch $branch.name $Config)) { continue }
        $file = Invoke-Gh api "repos/$Repository/contents/config/ymb.mod.yaml?ref=$($branch.commit.sha)" | ConvertFrom-Json
        $mod = ConvertFrom-Yaml ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($file.content)))
        [pscustomobject]@{ name = $branch.name; commit = $branch.commit; version = $mod.release.version }
    })
    Get-ReleasePlan $branches $Config
}

function Set-ModReleaseChannel([string] $Project, [string] $Repository, [string] $Tag, [bool] $Latest = ($Tag -ceq 'stable')) {
    Import-Module powershell-yaml -RequiredVersion 0.4.12
    $path = Join-Path $Project 'config/ymb.mod.yaml'
    $source = [IO.File]::ReadAllText($path)
    $mod = ConvertFrom-Yaml $source
    $base = "https://github.com/$Repository/releases"
    $url = $mod.release.url
    if (-not $url -or -not $url.StartsWith("$base/")) { return }
    $destination = if ($Latest) { "$base/latest/download/" } else { "$base/download/$([uri]::EscapeDataString($Tag))/" }
    $updatedUrl = $destination + [uri]::EscapeDataString([uri]::UnescapeDataString(([uri]$url).AbsolutePath.Split('/')[-1]))
    # Only the release URL changes; dependency URLs keep their authored channels.
    if ($source.TrimStart().StartsWith('{')) {
        $mod.release.url = $updatedUrl
        $updated = $mod | ConvertTo-Json -Depth 100
    } else {
        $updated = [regex]::Replace($source, '(?ms)(^release:\s*\r?\n)(.*?)(?=^\S|\z)', [Text.RegularExpressions.MatchEvaluator] {
            param($match)
            $match.Groups[1].Value + $match.Groups[2].Value.Replace($url, $updatedUrl)
        })
        if ($url -cne $updatedUrl -and $source -ceq $updated) {
            $mod.release.url = $updatedUrl
            $updated = ConvertTo-Yaml $mod
        }
    }
    if ($source -cne $updated) { [IO.File]::WriteAllText($path, $updated, [Text.UTF8Encoding]::new($false)) }
}

function Get-ModReleasePresentation([string] $Project, $Config, $Release, [string] $Version, [string[]] $Assets, [string] $Name = '') {
    $mod = ConvertFrom-Yaml (Get-Content -LiteralPath (Join-Path $Project 'config/ymb.mod.yaml') -Raw)
    if (-not $Name) { $Name = Split-Path -Leaf ([IO.Path]::GetFullPath($Project).TrimEnd('\', '/')) }
    $installer = @($Assets | Where-Object { [IO.Path]::GetFileName($_) -ceq "Deploy-$name.exe" }).Count -gt 0
    $manual = "extract $name-config.zip into YMB/mods/. Open YMB/YMB.exe, select this project, then build and sync."
    $instructions = if ($installer) {
        "For automatic setup, save Deploy-$name.exe beside GameData and CommonData in a WARNO mod folder and run it. Or, with YMB already installed, $manual"
    } else { "With YMB installed, $manual" }
    $instructions += ' After setup, run GenerateMod.bat and enable the mod in WARNO.'
    if ($installer) { $instructions += ' Before an installer update, back up settings, identities, source edits, and other projects outside YMB.' }
    Get-ReleasePresentation $Config $Release $Version $Assets @{ modName = $mod.name; modDescription = $mod.description; project = $name; instructions = $instructions }
}

function Publish-ModRelease([string] $Project, [string] $Directory, [string] $Repository, [string] $Branch, [string] $Sha, [bool] $Deleted = $false, [string] $Name = '') {
    # Removing a source branch must not break published download URLs.
    if ($Deleted) { return }
    $config = Get-ModReleaseConfig $Project
    if (-not (Get-ReleaseBranch $Branch $config)) { return }
    $plan = @(Get-RepositoryModReleasePlan $Repository $config)
    $release = @($plan | Where-Object branch -CEQ $Branch)
    if ($release.Count -ne 1 -or $release[0].sha -cne $Sha) { throw 'The release branch changed while artifacts were being checked. Run the workflow again.' }
    $release = $release[0]
    if (-not $Name) { $Name = Split-Path -Leaf ([IO.Path]::GetFullPath($Project).TrimEnd('\', '/')) }
    $archive = Join-Path $Directory "$name-config.zip"
    $version = Get-CheckedArchiveVersion $archive "$name/package-manifest.json"
    $mod = ConvertFrom-Yaml (Get-Content -LiteralPath (Join-Path $Project 'config/ymb.mod.yaml') -Raw)
    if ($version -cne [string]$mod.release.version) { throw 'The checked archive version differs from config/ymb.mod.yaml.' }
    Assert-ReleaseVersion $version $release.version $release.prerelease
    $assets = @(Get-ReleaseAssets $Directory $config)
    if ($archive -notin $assets) { throw 'release.assets must include the checked config archive.' }
    $presentation = Get-ModReleasePresentation $Project $config $release $version $assets $Name
    $channel = 'mod-' + [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($release.tag))).ToLowerInvariant()
    $notes = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($notes, $presentation.description, [Text.UTF8Encoding]::new($false))
        Publish-CheckedRelease $Repository $release.tag $Sha $assets $presentation.title $release.prerelease $release.latest $notes $config $channel
    } finally { Remove-Item -LiteralPath $notes -Force }
    Remove-ObsoleteReleases $Repository @($release.tag) @() $config $channel -TemporaryOnly
}

function Get-CompatibleBuilder([object[]] $Projects, [string] $Destination, [string] $Work) {
    $PSNativeCommandUseErrorActionPreference = $false
    $tags = @(Get-GitHubItems 'repos/Yokaiste/YMB/tags' | ForEach-Object name)
    $releases = @(Get-GitHubItems 'repos/Yokaiste/YMB/releases')
    $candidates = foreach ($release in $releases) {
        if ($release.draft -or $release.tag_name -cnotin $tags) { continue }
        $assets = @($release.assets | Where-Object name -Like 'YMB-*-windows-x64.zip')
        if ($assets.Count -eq 1 -and $assets[0].name -match '^YMB-v?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)-windows-x64.zip$') {
            [pscustomobject]@{ version = [System.Management.Automation.SemanticVersion] $Matches[1]; prerelease = [bool] $release.prerelease -or $release.tag_name.EndsWith('-pre') -or $Matches[1].Contains('-'); asset = $assets[0] }
        }
    }
    foreach ($candidate in ($candidates | Sort-Object prerelease, @{ Expression = 'version'; Descending = $true })) {
        $asset = $candidate.asset
        if ($asset.digest -notmatch '^sha256:[0-9a-fA-F]{64}$' -or -not $asset.browser_download_url.StartsWith('https://github.com/Yokaiste/YMB/releases/download/')) { throw 'No verified portable YMB asset.' }
        $attempt = [guid]::NewGuid().ToString('N')
        $archive = Join-Path $Work "YMB-$attempt.zip"
        Receive-Archive $asset.browser_download_url $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $asset.digest.Substring(7)) { throw 'YMB checksum mismatch.' }
        $unpacked = Join-Path $Work "portable-$attempt"
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $unpacked)
        $portable = $unpacked
        if (-not (Test-Path -LiteralPath (Join-Path $portable 'release-manifest.json') -PathType Leaf)) {
            $portable = Join-Path $unpacked 'YMB'
            if (-not (Test-Path -LiteralPath (Join-Path $portable 'release-manifest.json') -PathType Leaf) -or @(Get-ChildItem -LiteralPath $unpacked -Force).Count -ne 1) { continue }
        }
        $manifestPath = Join-Path $portable 'release-manifest.json'
        if ((Get-Item -LiteralPath $manifestPath).Length -gt 16MB) { throw 'Oversized YMB release manifest.' }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ([System.Management.Automation.SemanticVersion] $manifest.version -ne $candidate.version) { throw 'The YMB archive version differs from its release asset name.' }
        $fixture = Join-Path $Work "builder-$attempt"
        foreach ($name in @('GameData', 'CommonData')) { [IO.Directory]::CreateDirectory((Join-Path $fixture $name)) | Out-Null }
        $probe = Join-Path $fixture 'YMB'
        [IO.Directory]::CreateDirectory($probe) | Out-Null
        Get-ChildItem -LiteralPath $portable -Force | Copy-Item -Destination $probe -Recurse -Force
        foreach ($project in $Projects) {
            $config = Join-Path $probe "mods/$($project.name)/config"
            [IO.Directory]::CreateDirectory($config) | Out-Null
            Copy-Item -LiteralPath (Join-Path $project.root 'config/ymb.mod.yaml') -Destination $config
        }
        # The candidate's own parser checks its version against requires, without running generators.
        $output = & (Join-Path $probe 'YMB.exe') list --ymb-path $probe --require-all --json
        if ($LASTEXITCODE -eq 0 -and ($output | ConvertFrom-Json).status -eq 'ok') {
            [IO.Directory]::CreateDirectory($Destination) | Out-Null
            Get-ChildItem -LiteralPath $portable -Force | Copy-Item -Destination $Destination -Recurse -Force
            Write-Host "Using supported YMB $($candidate.version)."
            return $archive
        }
    }
    throw 'No matching YMB release supports these projects. Review requires in config/ymb.mod.yaml. Visit https://github.com/Yokaiste/YMB for releases and setup instructions.'
}
