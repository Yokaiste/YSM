param([string] $BuilderArchive = '')
. "$PSScriptRoot/releases.ps1"

function Assert([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}

function New-Project([string] $Directory, [string] $Id, [object[]] $Dependencies = @(), [string] $Requires = '*') {
    [IO.Directory]::CreateDirectory((Join-Path $Directory 'config')) | Out-Null
    $config = @{ version = 2; id = $Id; name = $Id; description = 'A useful mod description.'; requires = $Requires; dependencies = $Dependencies; release = @{ version = '1.0.0'; url = 'https://github.com/fixture/repository/releases/latest/download/Root-config.zip' } }
    [IO.File]::WriteAllText((Join-Path $Directory 'config/ymb.mod.yaml'), ($config | ConvertTo-Json -Depth 10))
}

function New-ProjectArchive([string] $Directory, [string] $Id, [object[]] $Dependencies = @()) {
    $stage = Join-Path $Directory 'stage'
    $project = Join-Path $stage $Id
    New-Project $project $Id $Dependencies
    $files = @{ 'config/ymb.mod.yaml' = (Get-FileHash -LiteralPath (Join-Path $project 'config/ymb.mod.yaml') -Algorithm SHA256).Hash.ToLowerInvariant() }
    @{ version = '1.0.0'; files = $files } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $project 'package-manifest.json')
    $archive = Join-Path $Directory 'project.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive)
    $archive
}

$testRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) "mod-release-tests-$([guid]::NewGuid())"))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
try {
    $notesProject = Join-Path $testRoot 'Fixture.Mod'
    New-Project $notesProject 'A readable title'
    $config = Get-ModReleaseConfig $notesProject
    $release = Get-ReleasePlan @([pscustomobject]@{name='master'; commit=@{sha='sha-master'}; version='1.0.0'}) $config
    $assetDirectory = Join-Path $testRoot 'assets'
    [IO.Directory]::CreateDirectory($assetDirectory) | Out-Null
    foreach ($name in @('Fixture.Mod-config.zip', 'Deploy-Fixture.Mod.exe')) {
        $asset = Join-Path $assetDirectory $name
        'Fixture bytes' | Set-Content -LiteralPath $asset
        "$((Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash)  $name" | Set-Content -LiteralPath "$asset.sha256"
    }
    $assets = @(Get-ReleaseAssets $assetDirectory $config)
    $presentation = Get-ModReleasePresentation $notesProject $config $release '1.0.0' $assets
    $text = $presentation.description
    Assert ($presentation.title -ceq '1.0.0') 'Default mod titles must contain only the version.'
    Assert ($text.Contains('Fixture.Mod-config.zip') -and $text.Contains('Deploy-Fixture.Mod.exe') -and $text -notmatch '\{\{[A-Za-z]+\}\}') 'Release notes must render archive and installer instructions.'
    Assert ($text.Contains('A readable title') -and $text.Contains('A useful mod description.') -and $text.Contains('https://github.com/Yokaiste/YMB') -and $text -match 'SHA-256[\s\S]*[0-9a-f]{64}') 'Mod notes must contain the title, description, YMB links, and checksums.'
    $presentation = Get-ModReleasePresentation $notesProject $config $release '1.0.0' @($assets | Where-Object { $_ -like '*.zip' })
    Assert ($presentation.description -notmatch 'Deploy-') 'Archive-only releases must omit installer instructions.'
    $modPath = Join-Path $notesProject 'config/ymb.mod.yaml'
    $mod = Get-Content -LiteralPath $modPath -Raw | ConvertFrom-Json -AsHashtable
    $mod.release.title = 'Build {{version}}'
    $mod.release.description = 'Custom setup.'
    $mod.release.assets = @('*')
    $mod.release.branches = @(@{name='main';tag='v{{version}}';latest=$true;prerelease=$false})
    $mod.release.managedTags = '^v[0-9]+\.[0-9]+\.[0-9]+$'
    $mod | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $modPath
    $custom = Get-ModReleaseConfig $notesProject
    $customPlan = @(Get-ReleasePlan @([pscustomobject]@{name='main';commit=@{sha='sha-main'};version='1.0.0'}) $custom)
    Assert ($customPlan.Count -eq 1 -and $customPlan[0].tag -ceq 'v1.0.0') 'Main config overrides must control branches and tags.'
    $assets = @(Get-ReleaseAssets $assetDirectory $custom)
    Assert ($assets.Count -eq 2 -and @($assets | Where-Object { $_ -like '*.sha256' }).Count -eq 0) 'Even wildcard uploads must exclude local checksums.'
    $presentation = Get-ModReleasePresentation $notesProject $custom $customPlan[0] '1.0.0' $assets
    Assert ($presentation.title -ceq 'Build 1.0.0' -and $presentation.description.StartsWith('Custom setup.') -and $presentation.description.Contains('SHA-256')) 'Overrides must render and keep checksums even without their placeholder.'
    $script:archives = @{}
    $script:downloads = [Collections.Generic.List[string]]::new()
    function Receive-Archive([string] $Url, [string] $Destination) {
        $script:downloads.Add($Url)
        if (-not $script:archives.ContainsKey($Url)) { throw "Unexpected fixture download: $Url" }
        Copy-Item -LiteralPath $script:archives[$Url] -Destination $Destination
    }
    $leaf = @{ url = 'https://fixture.example/Leaf-config.zip'; required = $false }
    $required = @{ url = 'https://fixture.example/Required-config.zip'; required = $true }
    $optional = @{ url = 'https://fixture.example/Optional-config.zip'; required = $false }
    $script:archives[$leaf.url] = New-ProjectArchive (Join-Path $testRoot 'leaf') 'Leaf'
    $script:archives[$required.url] = New-ProjectArchive (Join-Path $testRoot 'required') 'Required' @($leaf)
    $script:archives[$optional.url] = New-ProjectArchive (Join-Path $testRoot 'optional') 'Optional' @($leaf)
    $root = Join-Path $testRoot 'build/mods/Root'
    New-Project $root 'root' @($required, $optional)
    Assert (-not (Test-Path -LiteralPath (Join-Path $root '.ymb'))) 'The fixture must begin without installation data.'
    $projects = @(Get-ModProjects $root (Join-Path $testRoot 'dependencies'))
    Assert (($projects.name -join ',') -ceq 'Leaf,Required,Optional,Root') 'CI must include optional and nested dependencies in dependency order.'
    Assert (@($script:downloads | Where-Object { $_ -ceq $leaf.url }).Count -eq 1) 'Shared nested dependencies must download once.'
    foreach ($project in $projects) {
        Assert (Test-Path -LiteralPath (Join-Path $testRoot "build/mods/$($project.name)/config/ymb.mod.yaml")) 'Every dependency must be installed beside the authored project.'
    }
    Set-ModReleaseChannel $root 'fixture/repository' 'preview'
    $config = Get-Content -LiteralPath (Join-Path $root 'config/ymb.mod.yaml') -Raw | ConvertFrom-Json
    Assert ($config.release.url -ceq 'https://github.com/fixture/repository/releases/download/preview/Root-config.zip') 'Preview installers must download the preview archive.'
    Assert ($config.dependencies[0].url -ceq $required.url) 'Channel selection must preserve dependency URLs.'
    Set-ModReleaseChannel $root 'fixture/repository' 'stable'
    $config = Get-Content -LiteralPath (Join-Path $root 'config/ymb.mod.yaml') -Raw | ConvertFrom-Json
    Assert ($config.release.url.Contains('/latest/download/')) 'master must use the stable archive URL.'
    $inline = Join-Path $testRoot 'inline'
    [IO.Directory]::CreateDirectory((Join-Path $inline 'config')) | Out-Null
    'release: {version: "1.0.0", url: "https://github.com/fixture/repository/releases/latest/download/Inline-config.zip"}' | Set-Content -LiteralPath (Join-Path $inline 'config/ymb.mod.yaml')
    Set-ModReleaseChannel $inline 'fixture/repository' 'candidate/v1' $false
    $changed = ConvertFrom-Yaml (Get-Content -LiteralPath (Join-Path $inline 'config/ymb.mod.yaml') -Raw)
    Assert ($changed.release.url.Contains('/download/candidate%2Fv1/')) 'Custom tags and inline YAML must produce the right installer URL.'

    $loop = @{ url = 'https://fixture.example/Loop-config.zip'; required = $false }
    $script:archives[$loop.url] = New-ProjectArchive (Join-Path $testRoot 'loop') 'cycle' @($loop)
    $cycleRoot = Join-Path $testRoot 'cycle-build/mods/Root'
    New-Project $cycleRoot 'root' @($loop)
    $rejected = $false
    try { Get-ModProjects $cycleRoot (Join-Path $testRoot 'cycle-downloads') | Out-Null } catch { $rejected = $_ -match 'cycle' }
    Assert $rejected 'Nested optional cycles must fail before release preparation.'

    $corrupt = Join-Path $testRoot 'corrupt.zip'
    Copy-Item -LiteralPath $script:archives[$leaf.url] -Destination $corrupt
    $zip = [IO.Compression.ZipFile]::Open($corrupt, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry = $zip.GetEntry('Leaf/config/ymb.mod.yaml')
        $entry.Delete()
        $writer = [IO.StreamWriter]::new($zip.CreateEntry('Leaf/config/ymb.mod.yaml').Open())
        try { $writer.Write('changed') } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
    $rejected = $false
    try { Expand-ModArchive $corrupt (Join-Path $testRoot 'corrupt') | Out-Null } catch { $rejected = $_ -match 'checksum mismatch' }
    Assert $rejected 'Downloaded dependency contents must match their embedded checksums.'
    $legacy = Join-Path $testRoot 'legacy.zip'
    $zip = [IO.Compression.ZipFile]::Open($legacy, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $writer = [IO.StreamWriter]::new($zip.CreateEntry('Legacy/config/ymb.mod.yaml').Open())
        try { $writer.Write('{"version":1,"id":"legacy","scripts":[]}') } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
    $legacyUrl = 'https://fixture.example/Legacy-config.zip?token=private'
    $script:archives[$legacyUrl] = $legacy
    foreach ($legacyRequired in @($true, $false)) {
        $legacyRoot = Join-Path $testRoot "legacy-$legacyRequired/mods/Root"
        New-Project $legacyRoot 'root' @(@{url=$legacyUrl;required=$legacyRequired})
        $failure = ''
        try { Get-ModProjects $legacyRoot (Join-Path $testRoot "legacy-downloads-$legacyRequired") | Out-Null } catch { $failure = $_.Exception.Message }
        Assert ($failure.Contains('https://fixture.example/Legacy-config.zip') -and $failure.Contains("Dependency 'Legacy'") -and $failure.Contains('Rebuild and publish') -and -not $failure.Contains('private')) 'Legacy required and optional dependencies must fail with their URL and rebuild instructions, without logging query tokens.'
    }
    $oversized = Join-Path $testRoot 'oversized.zip'
    Copy-Item -LiteralPath $legacy -Destination $oversized
    $zip = [IO.Compression.ZipFile]::Open($oversized, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $stream = $zip.CreateEntry('Legacy/package-manifest.json').Open()
        try { $bytes = [byte[]]::new(16MB + 1); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    } finally { $zip.Dispose() }
    $rejected = $false
    try { Expand-ModArchive $oversized (Join-Path $testRoot 'oversized') | Out-Null } catch { $rejected = $_ -match 'larger than 16 MiB' }
    Assert $rejected 'Oversized manifests must fail separately from missing manifests.'
    $unsafe = Join-Path $testRoot 'unsafe.zip'
    $zip = [IO.Compression.ZipFile]::Open($unsafe, [IO.Compression.ZipArchiveMode]::Create)
    try { $zip.CreateEntry('../escaped.txt') | Out-Null } finally { $zip.Dispose() }
    $rejected = $false
    try { Expand-ModArchive $unsafe (Join-Path $testRoot 'unsafe') | Out-Null } catch { $rejected = $_ -match 'Unsafe' }
    Assert ($rejected -and -not (Test-Path -LiteralPath (Join-Path $testRoot 'escaped.txt'))) 'Archive traversal must fail before writing outside extraction.'
    $aliased = Join-Path $testRoot 'aliased.zip'
    $zip = [IO.Compression.ZipFile]::Open($aliased, [IO.Compression.ZipArchiveMode]::Create)
    try { $zip.CreateEntry('Root/a.txt') | Out-Null; $zip.CreateEntry('root/b.txt') | Out-Null } finally { $zip.Dispose() }
    $rejected = $false
    try { Expand-ModArchive $aliased (Join-Path $testRoot 'aliased') | Out-Null } catch { $rejected = $_ -match 'Aliased' }
    Assert $rejected 'Different spellings of an archive directory must fail before extraction.'

    $workflow = ConvertFrom-Yaml (Get-Content -LiteralPath "$PSScriptRoot/../workflows/release.yml" -Raw)
    foreach ($job in $workflow.jobs.Values) {
        foreach ($step in $job.steps) {
            if (-not $step.run) { continue }
            $tokens = $null
            $errors = $null
            [Management.Automation.Language.Parser]::ParseInput($step.run, [ref] $tokens, [ref] $errors) | Out-Null
            Assert (-not $errors) "Workflow PowerShell must parse: $($step.name): $errors"
        }
    }

    if ($BuilderArchive) {
        $script:builderSource = [IO.Path]::GetFullPath($BuilderArchive)
        $zip = [IO.Compression.ZipFile]::OpenRead($script:builderSource)
        try {
            $entry = $zip.GetEntry('YMB/release-manifest.json')
            if (-not $entry) { $entry = $zip.GetEntry('release-manifest.json') }
            $reader = [IO.StreamReader]::new($entry.Open())
            try { $actual = ($reader.ReadToEnd() | ConvertFrom-Json).version } finally { $reader.Dispose() }
        } finally { $zip.Dispose() }
        $digest = (Get-FileHash -LiteralPath $script:builderSource -Algorithm SHA256).Hash
        $asset = @{ name = "YMB-$actual-windows-x64.zip"; digest = "sha256:$digest"; browser_download_url = 'https://github.com/Yokaiste/YMB/releases/download/stable/YMB.zip' }
        $script:builderReleases = @(
            @{ tag_name = 'preview'; draft = $false; prerelease = $true; assets = @(@{ name = "YMB-$actual-windows-x64.zip"; digest = "sha256:$digest"; browser_download_url = 'https://github.com/Yokaiste/YMB/releases/download/preview/YMB.zip' }) },
            @{ tag_name = 'stable'; draft = $false; prerelease = $false; assets = @($asset) }
        )
        function gh {
            $global:LASTEXITCODE = 0
            if ($args[-1] -match '/tags\?per_page=') { '[[{"name":"stable"},{"name":"preview"}]]' }
            elseif ($args[-1] -match '/releases\?per_page=') { "[$(ConvertTo-Json -InputObject $script:builderReleases -Depth 10 -Compress)]" }
            else { throw 'Unexpected GitHub request.' }
        }
        $script:archives[$asset.browser_download_url] = $script:builderSource
        $script:archives[$script:builderReleases[0].assets[0].browser_download_url] = $script:builderSource
        New-Project $root 'root' @($required, $optional) "=$actual"
        $script:downloads.Clear()
        $work = Join-Path $testRoot 'builder-downloads'
        [IO.Directory]::CreateDirectory($work) | Out-Null
        Get-CompatibleBuilder $projects (Join-Path $testRoot 'supported') $work | Out-Null
        Assert ($script:downloads[0] -ceq $asset.browser_download_url) 'A matching stable must win over a matching preview.'
        Assert (Test-Path -LiteralPath (Join-Path $testRoot 'supported/YMB.exe')) 'CI must use the executable from the selected release archive.'
        Assert (-not (Test-Path -LiteralPath (Join-Path $testRoot 'supported/.ymb'))) 'Builder selection must work without .ymb.'
        $script:builderReleases = @($script:builderReleases[0])
        $script:downloads.Clear()
        Get-CompatibleBuilder $projects (Join-Path $testRoot 'preview-supported') $work | Out-Null
        Assert ($script:downloads.Count -eq 1 -and $script:downloads[0].Contains('/preview/')) 'CI must use a matching preview when no stable matches.'
        $legacy = Join-Path $testRoot 'legacy-builder'
        [IO.Directory]::CreateDirectory($legacy) | Out-Null
        'An older builder without Rust release metadata.' | Set-Content -LiteralPath (Join-Path $legacy 'README.txt')
        $legacyArchive = Join-Path $testRoot 'legacy-builder.zip'
        [IO.Compression.ZipFile]::CreateFromDirectory($legacy, $legacyArchive)
        $legacyDigest = (Get-FileHash -LiteralPath $legacyArchive -Algorithm SHA256).Hash
        $legacyAsset = @{ name = 'YMB-v1.0.0-windows-x64.zip'; digest = "sha256:$legacyDigest"; browser_download_url = 'https://github.com/Yokaiste/YMB/releases/download/legacy/YMB.zip' }
        $script:archives[$legacyAsset.browser_download_url] = $legacyArchive
        $script:builderReleases = @(@{ tag_name = 'stable'; draft = $false; prerelease = $false; assets = @($legacyAsset) }, $script:builderReleases[0])
        $script:downloads.Clear()
        Get-CompatibleBuilder $projects (Join-Path $testRoot 'legacy-fallback') $work | Out-Null
        Assert ($script:downloads.Count -eq 2 -and $script:downloads[-1].Contains('/preview/')) 'A legacy stable without the needed runtime must not block a matching preview.'
        $script:builderReleases = @($script:builderReleases[1])
        New-Project (Join-Path $testRoot 'build/mods/Leaf') 'leaf' @() '=999.0.0'
        $rejected = $false
        try { Get-CompatibleBuilder $projects (Join-Path $testRoot 'unsupported') $work | Out-Null } catch { $rejected = $_ -match 'No matching YMB release' }
        Assert $rejected 'A nested dependency requirement must reject an incompatible builder without an unsupported fallback.'
        $script:builderReleases = @()
        $rejected = $false
        try { Get-CompatibleBuilder $projects (Join-Path $testRoot 'missing') $work | Out-Null } catch { $rejected = $_ -match 'No matching YMB release' }
        Assert $rejected 'CI must fail clearly when no tagged matching builder exists.'
    }
    $script:commands = [Collections.Generic.List[object]]::new()
    $script:failUpload = $false
    $script:remoteReleases = [Collections.Generic.List[object]]::new()
    $script:remoteTags = [Collections.Generic.List[object]]::new()
    $script:branchHeads = @([pscustomobject]@{name='master';commit=@{sha='checked-sha'}})
    $script:branchConfigs = @{}
    $script:nextReleaseId = 10
    function gh {
        $script:commands.Add(@($args))
        $global:LASTEXITCODE = 0
        $endpoint = $args[-1]
        if ($args[0] -ceq 'api' -and $endpoint -match '/releases\?per_page=') { "[$(ConvertTo-Json -InputObject @($script:remoteReleases.ToArray()) -Depth 10 -Compress)]" }
        elseif ($args[0] -ceq 'api' -and $endpoint -match '/tags\?per_page=') { "[$(ConvertTo-Json -InputObject @($script:remoteTags.ToArray()) -Depth 10 -Compress)]" }
        elseif ($args[0] -ceq 'api' -and $endpoint -match '/branches\?per_page=') { "[$(ConvertTo-Json -InputObject $script:branchHeads -Depth 5 -Compress)]" }
        elseif ($args[0] -ceq 'api' -and $endpoint -match '/contents/config/ymb.mod.yaml\?ref=(.+)$') {
            $source = if ($script:branchConfigs.ContainsKey($Matches[1])) { $script:branchConfigs[$Matches[1]] } else { $script:releaseModSource }
            @{content=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($source))} | ConvertTo-Json
        }
        elseif ($args[0] -ceq 'release' -and $args[1] -ceq 'create') {
            if ($script:failUpload) { $global:LASTEXITCODE = 1; return }
            $script:nextReleaseId++
            $script:remoteReleases.Add([pscustomobject]@{id=$script:nextReleaseId;tag_name=$args[2];draft=$true;prerelease=('--prerelease' -cin $args);latest=$false;assets=@('new.zip')})
            $script:remoteTags.Add([pscustomobject]@{name=$args[2];commit=@{sha=$args[([array]::IndexOf($args,'--target')+1)]}})
            if ('--notes-file' -cin $args) { $script:publishedNotes = [IO.File]::ReadAllText($args[([array]::IndexOf($args,'--notes-file')+1)]) }
        }
        elseif ($args[0] -ceq 'release' -and $args[1] -ceq 'edit') {
            $release = $script:remoteReleases | Where-Object tag_name -CEQ $args[2]
            if (-not $release) { throw "Unknown mocked release: $($args[2])" }
            $release.tag_name = $args[([array]::IndexOf($args,'--tag')+1)]
            if ('--draft=false' -cin $args) { $release.draft = $false }
            if ('--latest=true' -cin $args) {
                foreach ($other in $script:remoteReleases) { $other.latest = $false }
                $release.latest = $true
            }
        }
        elseif ($args[0] -ceq 'api' -and 'POST' -cin $args) {
            $name = ($args | Where-Object { $_ -like 'ref=refs/tags/*' }).Substring(14)
            $sha = ($args | Where-Object { $_ -like 'sha=*' }).Substring(4)
            $script:remoteTags.Add([pscustomobject]@{name=$name;commit=@{sha=$sha}})
        }
        elseif ($args[0] -ceq 'api' -and 'PATCH' -cin $args) {
            $reference = $args | Where-Object { $_ -like 'repos/*/git/refs/tags/*' }
            $name = [uri]::UnescapeDataString(($reference -split '/tags/')[1])
            ($script:remoteTags | Where-Object name -CEQ $name).commit.sha = ($args | Where-Object { $_ -like 'sha=*' }).Substring(4)
        }
        elseif ($args[0] -ceq 'api' -and 'DELETE' -cin $args) {
            if ($endpoint -match '/releases/(\d+)$') { $id=[int]$Matches[1]; @($script:remoteReleases | Where-Object id -EQ $id) | ForEach-Object { [void]$script:remoteReleases.Remove($_) } }
            elseif ($endpoint -match '/git/refs/tags/(.+)$') { $name=[uri]::UnescapeDataString($Matches[1]); @($script:remoteTags | Where-Object name -CEQ $name) | ForEach-Object { [void]$script:remoteTags.Remove($_) } }
            else { throw 'Unexpected mocked deletion.' }
        }
        else { throw "Unexpected mocked GitHub command: $($args -join ' ')" }
    }
    Publish-CheckedRelease 'fixture/repository' 'preview' 'sha-dev' @('checked.zip') 'Fixture' $true $false
    Assert (@($script:commands | Where-Object { $_[0] -ceq 'release' -and $_[1] -ceq 'create' -and '--draft' -cin $_ -and '--prerelease' -cin $_ }).Count -eq 1) 'Preview uploads must finish in a prerelease draft.'
    Assert (@($script:commands | Where-Object { '--draft=false' -cin $_ -and '--latest=false' -cin $_ }).Count -eq 1) 'A preview must not replace latest stable.'
    $script:commands.Clear()
    Publish-CheckedRelease 'fixture/repository' 'stable' 'sha-master' @('checked.zip') 'Fixture' $false $true
    Assert (@($script:commands | Where-Object { '--draft=false' -cin $_ -and '--latest=true' -cin $_ }).Count -eq 1) 'master must explicitly publish latest stable.'
    $script:commands.Clear()
    $script:failUpload = $true
    $rejected = $false
    try { Publish-CheckedRelease 'fixture/repository' 'stable' 'sha-master' @('checked.zip') 'Fixture' $false $true } catch { $rejected = $true }
    Assert ($rejected -and @($script:commands | Where-Object { 'DELETE' -cin $_ -or 'edit' -cin $_ }).Count -eq 0) 'A failed upload must preserve existing releases and tags.'
    $script:failUpload = $false
    $publishProject = Join-Path $testRoot 'checkout'
    New-Project $publishProject 'published'
    $publishConfig = Join-Path $publishProject 'config/ymb.mod.yaml'
    $mod = Get-Content -LiteralPath $publishConfig -Raw | ConvertFrom-Json -AsHashtable
    $mod.release.generateNotes = $true
    $mod.release.discussionCategory = 'General'
    $mod.release.draft = $true
    $script:releaseModSource = $mod | ConvertTo-Json -Depth 10
    $script:releaseModSource | Set-Content -LiteralPath $publishConfig
    $archive = New-ProjectArchive (Join-Path $testRoot 'publication') 'Published.Mod'
    $dist = Join-Path $testRoot 'publication-dist'
    [IO.Directory]::CreateDirectory($dist) | Out-Null
    $checkedArchive = Join-Path $dist 'Published.Mod-config.zip'
    Copy-Item -LiteralPath $archive -Destination $checkedArchive
    "$((Get-FileHash -LiteralPath $checkedArchive -Algorithm SHA256).Hash)  Published.Mod-config.zip" | Set-Content -LiteralPath "$checkedArchive.sha256"
    $script:commands.Clear()
    $rejected = $false
    try { Publish-ModRelease $publishProject $dist 'fixture/repository' 'master' 'stale-sha' -Name Published.Mod } catch { $rejected = $_ -match 'branch changed' }
    Assert ($rejected -and @($script:commands | Where-Object { 'create' -cin $_ -or 'DELETE' -cin $_ }).Count -eq 0) 'A stale mod checkout must not change GitHub.'
    $script:commands.Clear()
    Publish-ModRelease $publishProject $dist 'fixture/repository' 'master' 'checked-sha' -Name Published.Mod
    $created = @($script:commands | Where-Object { $_[0] -ceq 'release' -and $_[1] -ceq 'create' })
    Assert ($created.Count -eq 1 -and '--generate-notes' -cin $created[0] -and @($created[0] | Where-Object { $_ -like '*.sha256' }).Count -eq 0) 'Mod publication must honor flags and omit sidecars.'
    Assert ($script:publishedNotes.Contains('Published.Mod-config.zip') -and $script:publishedNotes.Contains('SHA-256')) 'The configured project name must work even when the repository checkout has a different name.'
    Assert (@($script:commands | Where-Object { '--draft=true' -cin $_ -and '--latest=false' -cin $_ }).Count -eq 1) 'Configured drafts must not become latest.'
    $mod.release.draft = $false
    $script:releaseModSource = $mod | ConvertTo-Json -Depth 10
    $script:releaseModSource | Set-Content -LiteralPath $publishConfig
    $script:commands.Clear()
    Publish-ModRelease $publishProject $dist 'fixture/repository' 'master' 'checked-sha' -Name Published.Mod
    Assert (@($script:commands | Where-Object { '--draft=false' -cin $_ -and '--discussion-category' -cin $_ -and 'General' -cin $_ }).Count -eq 1) 'Discussion categories must be applied when publishing the completed draft.'
    $mod.release.managedTags = '^.*$'
    $script:releaseModSource = $mod | ConvertTo-Json -Depth 10
    $script:releaseModSource | Set-Content -LiteralPath $publishConfig
    foreach ($branch in @('dev', 'master')) {
        foreach ($otherState in @('legacy', 'absent')) {
            $targetTag = if ($branch -ceq 'dev') { 'preview' } else { 'stable' }
            $otherTag = if ($branch -ceq 'dev') { 'stable' } else { 'preview' }
            $otherBranch = if ($branch -ceq 'dev') { 'master' } else { 'dev' }
            $pending = 'mod-' + ('f' * 64) + '-staged-' + ('a' * 32)
            $script:remoteReleases.Clear(); $script:remoteTags.Clear()
            foreach ($tag in @('stable', 'preview', 'v0.9.0', $pending)) {
                $script:nextReleaseId++
                $script:remoteReleases.Add([pscustomobject]@{id=$script:nextReleaseId;tag_name=$tag;draft=($tag -ceq $pending);prerelease=($tag -ceq 'preview');latest=($tag -ceq 'stable');assets=@("old-$tag.zip")})
                $script:remoteTags.Add([pscustomobject]@{name=$tag;commit=@{sha="old-$tag"}})
            }
            $beforeRelease = $script:remoteReleases | Where-Object tag_name -CEQ $otherTag | ConvertTo-Json -Depth 5 -Compress
            $beforeTag = $script:remoteTags | Where-Object name -CEQ $otherTag | ConvertTo-Json -Depth 5 -Compress
            $script:branchHeads = @([pscustomobject]@{name=$branch;commit=@{sha='checked-sha'}})
            $script:branchConfigs = @{'legacy-sha'='{"version":1,"id":"legacy"}'}
            if ($otherState -ceq 'legacy') { $script:branchHeads += [pscustomobject]@{name=$otherBranch;commit=@{sha='legacy-sha'}} }
            $script:commands.Clear()
            Publish-ModRelease $publishProject $dist 'fixture/repository' $branch 'checked-sha' -Name Published.Mod
            $afterRelease = $script:remoteReleases | Where-Object tag_name -CEQ $otherTag | ConvertTo-Json -Depth 5 -Compress
            $afterTag = $script:remoteTags | Where-Object name -CEQ $otherTag | ConvertTo-Json -Depth 5 -Compress
            Assert ($beforeRelease -ceq $afterRelease -and $beforeTag -ceq $afterTag) "Publishing $targetTag must preserve $otherTag, its assets, and its commit when the other branch is $otherState."
            Assert (@($script:remoteReleases | Where-Object tag_name -CEQ $targetTag).Count -eq 1) 'Only the selected channel should be replaced.'
            Assert (@($script:remoteReleases | Where-Object tag_name -CEQ 'v0.9.0').Count -eq 1 -and @($script:remoteReleases | Where-Object tag_name -CEQ $pending).Count -eq 1) 'Published history and pending uploads for other channels must survive even a broad managedTags pattern.'
            $created = $script:commands | Where-Object { $_[0] -ceq 'release' -and $_[1] -ceq 'create' } | Select-Object -First 1
            $prefix = ($created[2] -split '-staged-')[0] + '-'
            Assert (@($script:remoteReleases | Where-Object { $_.tag_name.StartsWith($prefix) }).Count -eq 0 -and @($script:remoteTags | Where-Object { $_.name.StartsWith($prefix) }).Count -eq 0) 'Successful publication must remove only its own temporary releases and tags.'
        }
    }
    $script:commands.Clear()
    Publish-ModRelease -Project $publishProject -Deleted $true
    Assert ($script:commands.Count -eq 0) 'Deleting a source branch must not change published releases or tags.'
} finally {
    $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
    if ((Split-Path -Parent $testRoot) -cne $parent) { throw 'Release test cleanup escaped the temporary folder.' }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
$global:LASTEXITCODE = 0
Write-Host 'Mod dependency, release channel, and builder selection checks passed.'
