@echo off

echo Starting local Waku node...
echo ============================

REM Check if Docker is installed
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Docker is not installed. Please install Docker Desktop first.
    echo Download link: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

REM Check if Docker is running
docker info >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Docker is not running. Please start Docker Desktop.
    pause
    exit /b 1
)

REM Start local Waku node
echo Pulling Waku image...
docker pull statusteam/nim-waku:v0.20.0 >nul 2>nul

echo Starting Waku node...
docker run -d -p 60000:60000 -p 9000:9000 -p 8545:8545 --name nwaku statusteam/nim-waku:v0.20.0 ^
    --rpc --rpc-admin --rpc-port=8545 --rpc-address=0.0.0.0 ^
    --relay=true --filter=true --lightpush=true --store=true ^
    --topic=/waku/2/default-waku/proto

if %ERRORLEVEL% NEQ 0 (
    echo Failed to start Waku node. Please check Docker logs.
    pause
    exit /b 1
)

echo ============================
echo Local Waku node started successfully!
echo Node address: /ip4/127.0.0.1/tcp/60000/p2p/16Uiu2HAmPLe7Mzm8TsYUubgCAW1aJoeFScxrLj8ppHFivPo97bUZ
echo RPC endpoint: http://localhost:8545
echo ============================
echo To stop the node: docker stop nwaku
echo To remove the node: docker rm nwaku
echo ============================
pause