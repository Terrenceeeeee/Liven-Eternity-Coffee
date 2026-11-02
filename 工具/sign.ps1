param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Paths
)

$ErrorActionPreference = 'Stop'

function Get-LeafCert {
  Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq 'CN=Terrence' -and $_.HasPrivateKey -and $_.Issuer -ne $_.Subject } |
    Select-Object -First 1
}

function Get-RootCert {
  Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq 'CN=Terrence Root' -and $_.HasPrivateKey } |
    Select-Object -First 1
}

function Add-Trusted($cer, $store) {
  $certutil = Join-Path $env:SystemRoot 'System32\certutil.exe'
  & $certutil -user -addstore -f $store $cer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "certutil failed to add $cer to $store" }
}

$cert = Get-LeafCert
if (-not $cert) {
  $root = Get-RootCert
  if (-not $root) {
    Write-Output 'creating Terrence root certificate ...'
    $root = New-SelfSignedCertificate `
      -Type Custom `
      -Subject 'CN=Terrence Root' `
      -FriendlyName 'Terrence Root' `
      -KeyUsage CertSign, CRLSign, DigitalSignature `
      -KeyUsageProperty All `
      -KeyExportPolicy Exportable `
      -KeyLength 2048 `
      -HashAlgorithm SHA256 `
      -CertStoreLocation 'Cert:\CurrentUser\My' `
      -NotAfter (Get-Date).AddYears(10) `
      -TextExtension @('2.5.29.19={text}CA=true&pathlength=1', '2.5.29.37={text}1.3.6.1.5.5.7.3.3')
    $rootCer = Join-Path $PSScriptRoot 'certs\Terrence-Root.cer'
    New-Item -ItemType Directory -Path (Split-Path $rootCer) -Force | Out-Null
    Export-Certificate -Cert $root -FilePath $rootCer -Type CERT | Out-Null
    Add-Trusted $rootCer 'Root'
  }
  Write-Output 'creating Terrence code-signing certificate ...'
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject 'CN=Terrence' `
    -FriendlyName 'Terrence' `
    -Signer $root `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears(3)
  $leafCer = Join-Path $PSScriptRoot 'certs\Terrence.cer'
  Export-Certificate -Cert $cert -FilePath $leafCer -Type CERT | Out-Null
  Add-Trusted $leafCer 'TrustedPublisher'
}

foreach ($file in $Paths) {
  if (-not (Test-Path -LiteralPath $file)) { throw "missing file: $file" }
  Write-Output "signing: $file"
  $ok = $false
  for ($attempt = 1; $attempt -le 4 -and -not $ok; $attempt++) {
    try {
      Set-AuthenticodeSignature -FilePath $file -Certificate $cert -HashAlgorithm SHA256 `
        -TimestampServer 'http://timestamp.digicert.com' -ErrorAction Stop | Out-Null
    } catch {
      Write-Warning "timestamp failed, signing without timestamp: $($_.Exception.Message)"
      try {
        Set-AuthenticodeSignature -FilePath $file -Certificate $cert -HashAlgorithm SHA256 | Out-Null
      } catch {
        Write-Warning "sign attempt $attempt failed: $($_.Exception.Message)"
      }
    }
    Start-Sleep -Milliseconds (400 + 400 * $attempt)
    $sig = Get-AuthenticodeSignature -FilePath $file
    if ($sig.Status -eq 'Valid') {
      $ok = $true
      Write-Output "valid: $($sig.SignerCertificate.Subject)"
    } elseif ($attempt -lt 4) {
      Write-Warning "signature not ready ($($sig.Status)), retrying ..."
    }
  }
  if (-not $ok) {
    $sig = Get-AuthenticodeSignature -FilePath $file
    throw "signature invalid: $file ($($sig.Status): $($sig.StatusMessage))"
  }
}
