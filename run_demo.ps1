param(
    [int]$Port = 8003,
    [int]$MaxPort = 8020
)

$ErrorActionPreference = "Stop"

function Get-PythonCommand {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return "python"
    }

    if (Get-Command py -ErrorAction SilentlyContinue) {
        return "py"
    }

    throw "Python was not found. Install Python or add it to PATH."
}

function Test-PortAvailable {
    param([int]$CandidatePort)

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Parse("127.0.0.1"),
            $CandidatePort
        )
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($listener) {
            $listener.Stop()
        }
    }
}

$PythonCommand = Get-PythonCommand
$SelectedPort = $null

for ($CandidatePort = $Port; $CandidatePort -le $MaxPort; $CandidatePort++) {
    if (Test-PortAvailable -CandidatePort $CandidatePort) {
        $SelectedPort = $CandidatePort
        break
    }
}

if (-not $SelectedPort) {
    throw "No free port was found between $Port and $MaxPort."
}

Write-Host "Installing dependencies..."
& $PythonCommand -m pip install -r requirements.txt

Write-Host "Seeding demo data..."
& $PythonCommand seed_demo.py --reset-demo

Write-Host "Starting Student Task Manager on http://127.0.0.1:$SelectedPort"
& $PythonCommand -m uvicorn app.main:app --host 127.0.0.1 --port $SelectedPort
