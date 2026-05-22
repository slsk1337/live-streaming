# Screen Stream Share

A local browser-based screen streaming platform for sharing gameplay, YouTube playback, or any screen/window capture through a link.

## Features

- Host screen capture from the browser with optional system audio.
- Share a room link with viewers.
- WebRTC peer-to-peer video delivery through a lightweight Socket.IO signaling server.
- Resolution targets: 144p, 360p, 480p, 720p, 1080p, and 4K.
- Frame rate targets: 15, 30, and 60 fps.

## Run

```powershell
$env:npm_config_cache='D:\npm-cache'
$env:TEMP='D:\codex-temp'
$env:TMP='D:\codex-temp'
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Sharing Notes

The generated room link works immediately on the same machine. To share with other devices, the server must be reachable by them:

- Same network: use your computer's LAN IP instead of `localhost`, for example `http://192.168.1.20:3000/?room=abcd1234`.
- Internet viewers: deploy this app to a public HTTPS Node host with WebSocket support, or expose it through a trusted tunnel/reverse proxy.

Browsers allow screen capture on `localhost`; public hosting should use HTTPS.

Vercel and Netlify are not recommended for this exact app because the Socket.IO signaling server needs a persistent WebSocket-capable Node process.

## Free Render Deployment

1. Push this folder to a GitHub repository.
2. Open Render and choose **New +** > **Blueprint**.
3. Select the repository.
4. Render will read `render.yaml`.
5. Deploy the free web service.

After deployment, open the Render URL, start a stream, and share the generated room link.
