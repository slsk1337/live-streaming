const socket = io();

const profiles = {
  144: { label: "144p", width: 256, height: 144, bitrate: 180_000 },
  360: { label: "360p", width: 640, height: 360, bitrate: 700_000 },
  480: { label: "480p", width: 854, height: 480, bitrate: 1_200_000 },
  720: { label: "720p", width: 1280, height: 720, bitrate: 2_500_000 },
  1080: { label: "1080p", width: 1920, height: 1080, bitrate: 5_000_000 },
  2160: { label: "4K", width: 3840, height: 2160, bitrate: 15_000_000 }
};

const els = {
  status: document.getElementById("status"),
  viewerCount: document.getElementById("viewerCount"),
  preview: document.getElementById("preview"),
  emptyState: document.getElementById("emptyState"),
  hostTab: document.getElementById("hostTab"),
  watchTab: document.getElementById("watchTab"),
  hostPane: document.getElementById("hostPane"),
  watchPane: document.getElementById("watchPane"),
  resolution: document.getElementById("resolution"),
  fps: document.getElementById("fps"),
  includeAudio: document.getElementById("includeAudio"),
  startHost: document.getElementById("startHost"),
  stopHost: document.getElementById("stopHost"),
  shareLink: document.getElementById("shareLink"),
  copyLink: document.getElementById("copyLink"),
  roomInput: document.getElementById("roomInput"),
  joinRoom: document.getElementById("joinRoom")
};

let role = "idle";
let roomId = new URLSearchParams(location.search).get("room") || "";
let localStream = null;
let viewerPeer = null;
const hostPeers = new Map();

function setStatus(message) {
  els.status.textContent = message;
}

function setActivePane(next) {
  const isHost = next === "host";
  els.hostTab.classList.toggle("active", isHost);
  els.watchTab.classList.toggle("active", !isHost);
  els.hostPane.classList.toggle("active", isHost);
  els.watchPane.classList.toggle("active", !isHost);
}

function showVideo(stream) {
  els.preview.srcObject = stream;
  els.emptyState.style.display = stream ? "none" : "grid";
}

function currentProfile() {
  return {
    ...profiles[els.resolution.value],
    fps: Number(els.fps.value)
  };
}

function makeRoomId() {
  return crypto.randomUUID().slice(0, 8);
}

function getRoomFromInput(value) {
  try {
    const url = new URL(value);
    return url.searchParams.get("room") || value.trim();
  } catch {
    return value.trim();
  }
}

function rtcConfig() {
  return {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };
}

function tuneSender(sender, profile) {
  const params = sender.getParameters();
  params.encodings = params.encodings?.length ? params.encodings : [{}];
  params.encodings[0].maxBitrate = profile.bitrate;
  params.encodings[0].maxFramerate = profile.fps;
  return sender.setParameters(params).catch(() => {});
}

async function createHostPeer(viewerId) {
  const pc = new RTCPeerConnection(rtcConfig());
  hostPeers.set(viewerId, pc);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal:ice", { targetId: viewerId, candidate: event.candidate });
    }
  };

  const profile = currentProfile();
  for (const track of localStream.getTracks()) {
    const sender = pc.addTrack(track, localStream);
    if (track.kind === "video") tuneSender(sender, profile);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal:offer", { viewerId, description: pc.localDescription });
}

async function startHosting() {
  const profile = currentProfile();
  const constraints = {
    video: {
      width: { ideal: profile.width },
      height: { ideal: profile.height },
      frameRate: { ideal: profile.fps, max: profile.fps }
    },
    audio: els.includeAudio.checked
  };

  localStream = await navigator.mediaDevices.getDisplayMedia(constraints);
  localStream.getVideoTracks()[0]?.addEventListener("ended", stopHosting);
  showVideo(localStream);

  role = "host";
  roomId = roomId || makeRoomId();
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;
  history.replaceState(null, "", `?room=${encodeURIComponent(roomId)}`);
  els.shareLink.value = link;
  els.startHost.disabled = true;
  els.stopHost.disabled = false;
  socket.emit("host:join", { roomId, profile });
  setStatus(`Streaming ${profile.label} at ${profile.fps} fps.`);
}

function stopHosting() {
  for (const pc of hostPeers.values()) pc.close();
  hostPeers.clear();
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  role = "idle";
  els.startHost.disabled = false;
  els.stopHost.disabled = true;
  els.viewerCount.textContent = "0 watching";
  showVideo(null);
  setStatus("Stream stopped.");
}

async function joinAsViewer(nextRoomId) {
  roomId = nextRoomId;
  role = "viewer";
  viewerPeer?.close();
  viewerPeer = new RTCPeerConnection(rtcConfig());
  viewerPeer.ontrack = (event) => {
    showVideo(event.streams[0]);
    setStatus("Watching live stream.");
  };
  viewerPeer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal:ice", { targetId: viewerPeer.hostId, candidate: event.candidate });
    }
  };
  socket.emit("viewer:join", { roomId });
  setStatus("Connecting to stream...");
}

els.hostTab.addEventListener("click", () => setActivePane("host"));
els.watchTab.addEventListener("click", () => setActivePane("watch"));
els.startHost.addEventListener("click", () => startHosting().catch((error) => setStatus(error.message)));
els.stopHost.addEventListener("click", stopHosting);
els.copyLink.addEventListener("click", async () => {
  if (!els.shareLink.value) return;
  await navigator.clipboard.writeText(els.shareLink.value);
  setStatus("Viewer link copied.");
});
els.joinRoom.addEventListener("click", () => {
  const nextRoomId = getRoomFromInput(els.roomInput.value);
  if (nextRoomId) joinAsViewer(nextRoomId);
});
els.resolution.addEventListener("change", () => {
  retuneHostStream();
});
els.fps.addEventListener("change", () => {
  retuneHostStream();
});

function retuneHostStream() {
  if (role !== "host" || !localStream) return;
  const profile = currentProfile();
  socket.emit("host:profile", { roomId, profile });
  for (const pc of hostPeers.values()) {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind === "video") tuneSender(sender, profile);
    }
  }
  setStatus(`Streaming ${profile.label} at ${profile.fps} fps.`);
}

socket.on("host:ready", ({ viewers }) => {
  els.viewerCount.textContent = `${viewers} watching`;
});

socket.on("viewer:joined", ({ viewerId, count }) => {
  els.viewerCount.textContent = `${count} watching`;
  createHostPeer(viewerId).catch((error) => setStatus(error.message));
});

socket.on("viewer:left", ({ viewerId, count }) => {
  hostPeers.get(viewerId)?.close();
  hostPeers.delete(viewerId);
  els.viewerCount.textContent = `${count} watching`;
});

socket.on("signal:offer", async ({ hostId, description }) => {
  viewerPeer.hostId = hostId;
  await viewerPeer.setRemoteDescription(description);
  const answer = await viewerPeer.createAnswer();
  await viewerPeer.setLocalDescription(answer);
  socket.emit("signal:answer", { hostId, description: viewerPeer.localDescription });
});

socket.on("signal:answer", async ({ viewerId, description }) => {
  const pc = hostPeers.get(viewerId);
  if (pc) await pc.setRemoteDescription(description);
});

socket.on("signal:ice", async ({ fromId, candidate }) => {
  const pc = role === "host" ? hostPeers.get(fromId) : viewerPeer;
  if (pc) await pc.addIceCandidate(candidate).catch(() => {});
});

socket.on("room:waiting", () => {
  setStatus("Waiting for the host to start streaming.");
});

socket.on("room:error", setStatus);

socket.on("host:left", () => {
  viewerPeer?.close();
  viewerPeer = null;
  showVideo(null);
  setStatus("Host ended the stream.");
});

socket.on("stream:profile", (profile) => {
  if (role === "viewer") setStatus(`Stream available in ${profile.label} at ${profile.fps} fps.`);
});

if (roomId) {
  setActivePane("watch");
  els.roomInput.value = roomId;
  joinAsViewer(roomId);
}
