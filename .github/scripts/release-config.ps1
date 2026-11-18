# Shared publishing rules. Keep local packaging and verification independent of GitHub.
function New-ReleaseRegex([string] $Pattern) {
    if (-not $Pattern.StartsWith('^') -or -not $Pattern.EndsWith('$')) { throw 'Release patterns must be anchored with ^ and $.' }
    [regex]::new($Pattern, [Text.RegularExpressions.RegexOptions]::CultureInvariant, [timespan]::FromSeconds(1))
}

function Read-ReleaseConfig([string] $Path, [System.Collections.IDictionary] $Overrides = @{}) {
    $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
    foreach ($key in $Overrides.Keys) { $config[$key] = $Overrides[$key] }
    $keys = @('title', 'description', 'assets', 'draft', 'generateNotes', 'discussionCategory', 'managedTags', 'branches')
    foreach ($key in $config.Keys) { if ($key -cnotin $keys) { throw "Unknown release setting: $key" } }
    foreach ($key in @('title', 'description', 'discussionCategory', 'managedTags')) {
        if ($config[$key] -isnot [string]) { throw "release.$key must be text." }
    }
    if (-not $config.title.Trim() -or $config.title -match '[\r\n\x00-\x1f]') { throw 'Release titles must be nonempty single lines.' }
    if ($config.discussionCategory -match '[\r\n\x00-\x1f]') { throw 'release.discussionCategory must be a single line.' }
    foreach ($key in @('draft', 'generateNotes')) { if ($config[$key] -isnot [bool]) { throw "release.$key must be true or false." } }
    if ($config.assets -isnot [Collections.IList] -or -not $config.assets.Count) { throw 'release.assets must contain filename patterns.' }
    foreach ($asset in $config.assets) {
        if ($asset -isnot [string] -or -not $asset -or $asset -match '[/\\:\x00-\x1f]' -or $asset -in @('.', '..') -or $asset.StartsWith('-')) { throw 'release.assets accepts filename patterns inside dist, without paths.' }
    }
    if ($config.managedTags) { $null = New-ReleaseRegex $config.managedTags }
    if ($config.branches -isnot [Collections.IList]) { throw 'release.branches must be a list of rules.' }
    foreach ($rule in $config.branches) {
        if ($rule -isnot [System.Collections.IDictionary]) { throw 'Each release branch rule must be an object.' }
        foreach ($key in $rule.Keys) { if ($key -cnotin @('name', 'pattern', 'tag', 'prerelease', 'latest')) { throw "Unknown release branch setting: $key" } }
        if ([bool]$rule.name -eq [bool]$rule.pattern -or $rule.tag -isnot [string] -or -not $rule.tag) { throw 'Each release branch rule needs either name or pattern, and a tag.' }
        foreach ($key in @('name', 'pattern', 'tag')) {
            if ($rule.Contains($key) -and ($rule[$key] -isnot [string] -or $rule[$key] -match '[\r\n\x00-\x1f]')) { throw "Invalid release branch $key." }
        }
        if ($rule.pattern) { $null = New-ReleaseRegex $rule.pattern }
        foreach ($key in @('prerelease', 'latest')) {
            if (-not $rule.Contains($key)) { $rule[$key] = $false }
            if ($rule[$key] -isnot [bool] -and $rule[$key] -cne 'auto') { throw "Branch $key must be true, false, or auto." }
        }
    }
    $config
}

function Get-ReleaseBranch([string] $Name, $Config) {
    $found = @($Config.branches | Where-Object { if ($_.name) { $_.name -ceq $Name } else { (New-ReleaseRegex $_.pattern).IsMatch($Name) } })
    if ($found.Count -gt 1) { throw "More than one release rule matches branch $Name." }
    if ($found.Count) { $found[0] }
}

function Expand-ReleaseText([string] $Text, [hashtable] $Values) {
    [regex]::Replace($Text, '\{\{([^{}\r\n]+)\}\}', [Text.RegularExpressions.MatchEvaluator] {
        param($match)
        $key = $match.Groups[1].Value
        if (-not $Values.ContainsKey($key)) { throw "Unknown release placeholder: {{$key}}" }
        [string]$Values[$key]
    })
}

function Get-ReleasePlan([object[]] $Branches, $Config) {
    $candidates = @(foreach ($branch in $Branches) {
        $rule = Get-ReleaseBranch $branch.name $Config
        if (-not $rule) { continue }
        $version = $branch.version
        $preview = $false
        if ($rule.pattern) {
            $match = (New-ReleaseRegex $rule.pattern).Match($branch.name)
            if ($match.Groups['version'].Success) {
                $version = $match.Groups['version'].Value
                if (-not $version) { throw "The version capture is empty for branch $($branch.name). Fix its release pattern." }
            }
            $preview = [bool]$match.Groups['preview'].Value
        }
        if (-not $version) { continue }
        $parsed = [System.Management.Automation.SemanticVersion]$version
        [pscustomobject]@{ branch = $branch.name; sha = $branch.commit.sha; version = [string]$version; parsed = $parsed; preview = $preview -or [bool]$parsed.PreReleaseLabel; rule = $rule }
    })
    $stable = $candidates | Where-Object { $_.rule.latest -is [bool] -and $_.rule.latest -and -not ($_.rule.prerelease -is [bool] -and $_.rule.prerelease) } | Sort-Object parsed -Descending | Select-Object -First 1
    $plan = @(foreach ($candidate in $candidates) {
        $rule = $candidate.rule
        $pre = if ($rule.prerelease -is [string]) { $candidate.preview -or ($stable -and $candidate.parsed -gt $stable.parsed) } else { $rule.prerelease }
        if ($candidate.parsed.PreReleaseLabel -and -not $pre) { throw 'A semantic prerelease needs prerelease: true or auto in its branch rule.' }
        $values = @{ version = $candidate.version; major = $candidate.parsed.Major; minor = $candidate.parsed.Minor; patch = $candidate.parsed.Patch; branch = $candidate.branch; previewSuffix = $(if ($pre) { '-pre' } else { '' }) }
        $tag = Expand-ReleaseText $rule.tag $values
        if ($tag -match '[\s\x00-\x1f~^:?*\[\\]' -or $tag -match '\.\.|@\{|//|^/|(?:^|/)\.|\.lock(?:/|$)|[/.]$' -or $tag -in @('@', '') -or $tag.StartsWith('-')) { throw "Invalid release tag: $tag" }
        if ($Config.managedTags -and -not (New-ReleaseRegex $Config.managedTags).IsMatch($tag)) { throw "Tag $tag is outside release.managedTags. Update the cleanup pattern with your branch rules." }
        [pscustomobject]@{ branch = $candidate.branch; sha = $candidate.sha; version = $candidate.version; tag = $tag; prerelease = [bool]$pre; latest = ($rule.latest -is [bool] -and $rule.latest); automaticLatest = ($rule.latest -is [string]); parsed = $candidate.parsed }
    })
    $plan = @($plan | Group-Object -CaseSensitive tag | ForEach-Object { $_.Group | Sort-Object @{Expression='latest';Descending=$true}, @{Expression='parsed';Descending=$true}, branch | Select-Object -First 1 })
    if (@($plan | Where-Object latest).Count -gt 1) { throw 'Only one active release may set latest to true.' }
    if (@($plan | Where-Object { $_.latest -and $_.prerelease }).Count) { throw 'A preview cannot be the latest stable release.' }
    if (-not ($plan | Where-Object latest)) {
        $latest = $plan | Where-Object { $_.automaticLatest -and -not $_.prerelease } | Sort-Object parsed -Descending | Select-Object -First 1
        if ($latest) { $latest.latest = $true }
    }
    $plan | Sort-Object parsed, branch | Select-Object branch, sha, version, tag, prerelease, latest
}

function Get-ReleaseAssets([string] $Directory, $Config) {
    $assets = @(Get-ChildItem -LiteralPath $Directory -File | Where-Object {
        $file = $_
        $file.Extension -ine '.sha256' -and @($Config.assets | Where-Object { $file.Name -like $_ }).Count -gt 0
    } | Sort-Object Name)
    if (-not $assets.Count) { throw 'No release assets match release.assets.' }
    foreach ($asset in $assets) {
        if ($asset.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Release assets cannot be links: $($asset.Name)" }
        if ($asset.Name.Contains('#')) { throw "Rename release asset $($asset.Name): GitHub CLI treats # as an asset label." }
        if ($asset.Extension -in @('.zip', '.exe') -or (Test-Path -LiteralPath "$($asset.FullName).sha256")) { Assert-ReleaseChecksum $asset.FullName }
    }
    $assets.FullName
}

function Assert-ReleaseChecksum([string] $Path) {
    $expected = (Get-Content -LiteralPath "$Path.sha256" -Raw).Split(' ')[0].Trim()
    if ($expected -notmatch '^[0-9a-fA-F]{64}$' -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $expected) { throw 'Release checksum mismatch.' }
}

function Assert-ReleaseVersion([string] $Actual, [string] $Expected, [bool] $Prerelease) {
    $actualVersion = [System.Management.Automation.SemanticVersion]$Actual
    $expectedVersion = [System.Management.Automation.SemanticVersion]$Expected
    if ($actualVersion.Major -ne $expectedVersion.Major -or $actualVersion.Minor -ne $expectedVersion.Minor -or $actualVersion.Patch -ne $expectedVersion.Patch -or (-not $Prerelease -and $actualVersion.PreReleaseLabel)) { throw 'The checked archive version does not match its release branch.' }
}

function Get-ReleasePresentation($Config, $Release, [string] $Version, [string[]] $Assets, [hashtable] $Values = @{}) {
    $parsed = [System.Management.Automation.SemanticVersion]$Version
    $Values.version = $Version
    $Values.major = $parsed.Major; $Values.minor = $parsed.Minor; $Values.patch = $parsed.Patch
    $Values.branch = $Release.branch; $Values.tag = $Release.tag
    $Values.previewSuffix = if ($Release.prerelease) { '-pre' } else { '' }
    $sums = @($Assets | ForEach-Object { "$((Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_))" })
    $Values.checksums = "SHA-256`n`n``````text`n$($sums -join "`n")`n``````"
    $title = Expand-ReleaseText $Config.title $Values
    $body = Expand-ReleaseText $Config.description $Values
    if (-not $Config.description.Contains('{{checksums}}')) { $body = "$($body.TrimEnd())`n`n$($Values.checksums)" }
    if (-not $title.Trim() -or $title -match '[\r\n\x00-\x1f]') { throw 'The rendered release title must be a nonempty single line.' }
    [pscustomobject]@{ title = $title; description = $body }
}

function Invoke-Gh {
    param([Parameter(ValueFromRemainingArguments)] [string[]] $Arguments)
    $output = & gh @Arguments
    if ($LASTEXITCODE) { throw "GitHub command failed: gh $($Arguments -join ' ')" }
    $output
}

function Get-GitHubItems([string] $Endpoint) {
    $pages = (Invoke-Gh api --paginate --slurp "$Endpoint`?per_page=100") | ConvertFrom-Json -NoEnumerate
    foreach ($page in $pages) { foreach ($item in $page) { $item } }
}

function Get-ReleaseCleanup([object[]] $Releases, [object[]] $Tags, [string[]] $Keep, [string[]] $Replace) {
    [pscustomobject]@{
        releases = @($Releases | Where-Object { $_.tag_name -cnotin $Keep -or $_.tag_name -cin $Replace } | ForEach-Object id)
        tags = @($Tags | Where-Object { $_.name -cnotin $Keep -or $_.name -cin $Replace } | ForEach-Object name)
    }
}

function Remove-ObsoleteReleases([string] $Repository, [string[]] $Keep, [string[]] $Replace, $Config, [string] $Prefix, [switch] $TemporaryOnly) {
    $managed = if (-not $TemporaryOnly -and $Config.managedTags) { New-ReleaseRegex $Config.managedTags }
    $temporary = New-ReleaseRegex "^$Prefix-(?:staged|previous)-[0-9a-f]+$"
    $backups = New-ReleaseRegex "^$Prefix-previous-[0-9a-f]+$"
    $releases = @(Get-GitHubItems "repos/$Repository/releases")
    $publishedBackups = @($releases | Where-Object { $Config.draft -and -not $_.draft -and $backups.IsMatch($_.tag_name) } | ForEach-Object tag_name)
    $releases = @($releases | Where-Object { $_.tag_name -cnotin $publishedBackups -and ($temporary.IsMatch($_.tag_name) -or ($managed -and $managed.IsMatch($_.tag_name))) })
    $tags = @(Get-GitHubItems "repos/$Repository/tags" | Where-Object { $_.name -cnotin $publishedBackups -and ($temporary.IsMatch($_.name) -or ($managed -and $managed.IsMatch($_.name))) })
    $cleanup = Get-ReleaseCleanup $releases $tags $Keep $Replace
    foreach ($id in $cleanup.releases) { Invoke-Gh api --method DELETE "repos/$Repository/releases/$id" | Out-Null }
    foreach ($tag in $cleanup.tags) {
        $escaped = [uri]::EscapeDataString($tag)
        Invoke-Gh api --method DELETE "repos/$Repository/git/refs/tags/$escaped" | Out-Null
    }
}

function Publish-CheckedRelease([string] $Repository, [string] $Tag, [string] $Sha, [string[]] $Assets, [string] $Title, [bool] $Prerelease, [bool] $Latest, [string] $NotesFile = '', $Config = @{}, [string] $Prefix = 'mod') {
    if (@($Assets | Where-Object { [IO.Path]::GetExtension($_) -ieq '.sha256' }).Count) { throw 'Checksum sidecars belong in local dist only. Put checksums in the release description.' }
    $staged = "$Prefix-staged-$([guid]::NewGuid().ToString('N'))"
    $arguments = @('release', 'create', $staged) + $Assets + @('--repo', $Repository, '--target', $Sha, '--title', $Title, '--draft', '--latest=false')
    if ($Prerelease) { $arguments += '--prerelease' }
    if ($NotesFile) { $arguments += @('--notes-file', $NotesFile) }
    if ($Config.generateNotes) { $arguments += '--generate-notes' }
    Invoke-Gh @arguments | Out-Null
    $old = @(Get-GitHubItems "repos/$Repository/releases" | Where-Object tag_name -CEQ $Tag)
    $tags = @(Get-GitHubItems "repos/$Repository/tags")
    $reference = @($tags | Where-Object name -CEQ $Tag)
    $backup = "$Prefix-previous-$([guid]::NewGuid().ToString('N'))"
    if ($old.Count) {
        if ($old.Count -ne 1 -or $reference.Count -ne 1) { throw 'The previous release must have one matching tag.' }
        Invoke-Gh api --method POST "repos/$Repository/git/refs" -f "ref=refs/tags/$backup" -f "sha=$($reference[0].commit.sha)" | Out-Null
        Invoke-Gh release edit $Tag --repo $Repository --tag $backup | Out-Null
    }
    try {
        if ($reference.Count) {
            $escaped = [uri]::EscapeDataString($Tag)
            Invoke-Gh api --method PATCH "repos/$Repository/git/refs/tags/$escaped" -f "sha=$Sha" -F force=true | Out-Null
        } else {
            Invoke-Gh api --method POST "repos/$Repository/git/refs" -f "ref=refs/tags/$Tag" -f "sha=$Sha" | Out-Null
        }
        $draft = [bool]$Config.draft
        $promotion = @('release', 'edit', $staged, '--repo', $Repository, '--tag', $Tag, "--draft=$($draft.ToString().ToLowerInvariant())", "--latest=$(($Latest -and -not $draft).ToString().ToLowerInvariant())")
        if (-not $draft -and $Config.discussionCategory) { $promotion += @('--discussion-category', $Config.discussionCategory) }
        Invoke-Gh @promotion | Out-Null
    } catch {
        # Keep the previous assets published even if GitHub is unavailable during recovery.
        throw "Release promotion failed. Previous assets remain under $backup when a previous release existed. The staged release is $staged. $($_.Exception.Message)"
    }
}
