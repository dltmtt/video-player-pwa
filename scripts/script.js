const preferences = {
  speed: 1.8,
  timeSkip: 10,
};

// SERVICE WORKER
navigator.serviceWorker.register("service-worker.js");

// HTML ELEMENTS
const dragPanel = document.querySelector("#drag-panel");
const dropOverlay = document.querySelector("#drop-overlay");
const droppableElements = document.querySelectorAll(".droppable");
const message = document.querySelector("#message");
const fileName = document.querySelector("#file-name");
const video = document.querySelector("video");

const filePicker = document.querySelector("#file-picker");

const player = document.querySelector("#player");
const playBtn = document.querySelector("#play-btn");
const fullscreenBtn = document.querySelector("#fullscreen-btn");
const zoomBtn = document.querySelector("#zoom-btn");
const speedControls = document.querySelector("#speed-controls");
const subtitlesBtn = document.querySelector("#subtitles-btn");
const subtitlePicker = document.querySelector("#subtitle-picker");

const progressBar = document.querySelector("#video-bar");
const timeIndicatorToggle = document.querySelector("#time-indicator-toggle");
const timeIndicator = document.querySelector("#time-indicator");
const replayBtn = document.querySelector("#replay-btn");
const forwardBtn = document.querySelector("#forward-btn");
const durationOrFinishAt = document.querySelector("#duration-or-finish-at");

let currentTrackUrl = null;

// SUBTITLE & FILE HELPER FUNCTIONS
function isVideoFile(file) {
  if (!file) return false;
  const name = file.name ? file.name.toLowerCase() : "";
  const type = file.type ? file.type.toLowerCase() : "";
  return (
    type.startsWith("video/") ||
    /\.(mp4|mkv|webm|avi|mov|wmv|flv|m4v|ogv)$/i.test(name)
  );
}

function isSubtitleFile(file) {
  if (!file) return false;
  const name = file.name ? file.name.toLowerCase() : "";
  const type = file.type ? file.type.toLowerCase() : "";
  return (
    name.endsWith(".vtt") ||
    name.endsWith(".srt") ||
    type === "text/vtt" ||
    type === "application/x-subrip"
  );
}

function srtToVtt(srtText) {
  let vtt = srtText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${vtt}`;
}

function clearSubtitles() {
  if (currentTrackUrl) {
    URL.revokeObjectURL(currentTrackUrl);
    currentTrackUrl = null;
  }
  const tracks = video.querySelectorAll("track");
  for (const t of tracks) {
    t.remove();
  }
  updateSubtitlesBtnState();
}

async function loadSubtitleFile(file) {
  if (!file) return;

  clearSubtitles();

  try {
    const text = await file.text();
    let vttContent;
    if (
      file.name.toLowerCase().endsWith(".vtt") ||
      text.trim().startsWith("WEBVTT")
    ) {
      vttContent = text;
    } else {
      vttContent = srtToVtt(text);
    }

    const blob = new Blob([vttContent], { type: "text/vtt" });
    currentTrackUrl = URL.createObjectURL(blob);

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = file.name.replace(/\.[^.]+$/, "");
    track.srclang = "en";
    track.src = currentTrackUrl;
    track.default = true;

    video.appendChild(track);

    if (track.track) {
      track.track.mode = "showing";
    }

    if (video.textTracks && video.textTracks.length > 0) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode =
          i === video.textTracks.length - 1 ? "showing" : "disabled";
      }
    }

    updateSubtitlesBtnState();
  } catch (err) {
    console.error("Failed to load subtitle file:", err);
  }
}

async function pickSubtitleFile() {
  if ("showOpenFilePicker" in window) {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [
          {
            description: "Subtitles",
            accept: {
              "text/vtt": [".vtt"],
              "application/x-subrip": [".srt"],
              "text/plain": [".srt", ".vtt"],
            },
          },
        ],
        multiple: false,
      });
      const file = await fileHandle.getFile();
      await loadSubtitleFile(file);
    } catch (_abortError) {
      // User cancelled
    }
  } else {
    subtitlePicker?.click();
  }
}

function toggleSubtitles() {
  const tracks = video.textTracks;
  if (!tracks || tracks.length === 0) {
    pickSubtitleFile();
    return;
  }

  const anyShowing = Array.from(tracks).some((t) => t.mode === "showing");

  for (let i = 0; i < tracks.length; i++) {
    tracks[i].mode = anyShowing ? "disabled" : "showing";
  }

  updateSubtitlesBtnState();
}

function updateSubtitlesBtnState() {
  if (!subtitlesBtn) return;
  const tracks = video.textTracks;
  const hasShowingTrack =
    tracks && Array.from(tracks).some((t) => t.mode === "showing");
  const hasAnyTrack = tracks && tracks.length > 0;

  if (hasShowingTrack) {
    subtitlesBtn.textContent = "subtitles";
    subtitlesBtn.dataset.active = "true";
    subtitlesBtn.setAttribute("aria-label", "Disable subtitles");
    subtitlesBtn.title =
      "Subtitles on (Click to disable, right-click to load file)";
  } else {
    subtitlesBtn.textContent = "subtitles_off";
    delete subtitlesBtn.dataset.active;
    if (hasAnyTrack) {
      subtitlesBtn.setAttribute("aria-label", "Enable subtitles");
      subtitlesBtn.title =
        "Subtitles off (Click to enable, right-click to load file)";
    } else {
      subtitlesBtn.setAttribute("aria-label", "Load subtitles");
      subtitlesBtn.title = "Load subtitles (Click or press V)";
    }
  }
}

// DRAG AND DROP
let localStorageKey;
const LOCAL_STORAGE_NAMESPACE = "video-player_";

for (const droppable of droppableElements) {
  droppable.addEventListener("dragenter", (_e) => {
    droppable.dataset.fileHover = true;
    dropOverlay.hidden = false;
  });
}

dropOverlay.addEventListener("dragover", (e) => e.preventDefault());

dropOverlay.addEventListener("drop", async (e) => {
  e.preventDefault();

  const fileHandles = [];
  const files = [];

  if (e.dataTransfer.items) {
    for (const item of e.dataTransfer.items) {
      if (item.kind === "file") {
        if ("getAsFileSystemHandle" in item) {
          try {
            const handle = await item.getAsFileSystemHandle();
            if (handle) fileHandles.push(handle);
          } catch (_err) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        } else {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }
  } else if (e.dataTransfer.files) {
    files.push(...e.dataTransfer.files);
  }

  const allItems = [];
  for (const handle of fileHandles) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      allItems.push({ file, handle });
    }
  }
  for (const file of files) {
    allItems.push({ file, handle: null });
  }

  const videoItem = allItems.find((i) => isVideoFile(i.file));
  const subtitleItem = allItems.find((i) => isSubtitleFile(i.file));

  if (videoItem) {
    if (!video.src) {
      showLoadingScreen();
    }
    await manageFileHandle(videoItem.handle || videoItem.file);
  }

  if (subtitleItem) {
    await loadSubtitleFile(subtitleItem.file);
  } else if (!videoItem && allItems.length > 0) {
    const first = allItems[0];
    if (isSubtitleFile(first.file)) {
      await loadSubtitleFile(first.file);
    } else {
      if (!video.src) showLoadingScreen();
      await manageFileHandle(first.handle || first.file);
    }
  }

  handleDragEnd();
});

dropOverlay.addEventListener("dragleave", handleDragEnd);

function handleDragEnd() {
  dropOverlay.hidden = true;
  for (const droppable of droppableElements) {
    delete droppable.dataset.fileHover;
  }
}

// FILE INPUT
filePicker?.addEventListener("click", async () => {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      excludeAcceptAllOption: true,
      types: [
        {
          description: "Videos",
          accept: {
            "video/*": [], // Chrome uses the MIME type, not the file extensions
          },
        },
      ],
      multiple: false,
    });

    showLoadingScreen();

    manageFileHandle(fileHandle);
  } catch (_abortError) {
    // User cancelled the file picker, do nothing
  }
});

// FILE HANDLING
function showLoadingScreen() {
  message.textContent = "Loading…";
  filePicker?.remove();
}

async function manageFileHandle(fileHandle) {
  const file = fileHandle.getFile ? await fileHandle.getFile() : fileHandle;

  // Display the file name without the extension
  fileName.textContent = file.name.replace(/\.[^.]+$/, "");

  if (video.src) {
    updateLocalStorage();
    URL.revokeObjectURL(video.src);
    clearSubtitles();
  }

  // Don't change the order of these two lines! Otherwise, the loadedmetadata event
  // fires before a new hash is computed and if I drag 'n' drop another video, the
  // previous video's state is restored instead of the new one's
  localStorageKey = `${LOCAL_STORAGE_NAMESPACE}${await computeFileSignature(file)}`;
  video.src = URL.createObjectURL(file);

  // Update the media session on first play
  video.addEventListener(
    "seeked",
    () => {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: fileName.textContent,
      });
    },
    { once: true },
  );

  // Bind the global media controls to the video
  navigator.mediaSession.setActionHandler("seekbackward", replay);
  navigator.mediaSession.setActionHandler("previoustrack", replay);
  navigator.mediaSession.setActionHandler("previousslide", replay);
  navigator.mediaSession.setActionHandler("seekforward", forward);
  navigator.mediaSession.setActionHandler("nexttrack", forward);
  navigator.mediaSession.setActionHandler("nextslide", forward);

  // If the fonts are not loaded in 100ms, show the player anyway
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  Promise.race([document.fonts.ready, wait(100)]).then(() => {
    document.startViewTransition?.(showPlayer) ?? showPlayer();
  });

  function showPlayer() {
    dragPanel.hidden = true;
    player.hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.launchQueue.setConsumer((launchParams) => {
    if (launchParams.files?.length) {
      const file = launchParams.files[0];
      showLoadingScreen();
      manageFileHandle(file);
    }
  });
});

// CONTROL PLAYBACK
// Play/pause
playBtn.onclick = togglePlay;
video.onclick = togglePlay;
video.onpause = () => {
  playBtn.textContent = "play_arrow";
};
video.onplay = () => {
  playBtn.textContent = "pause";
};

// Fullscreen
fullscreenBtn.onclick = toggleFullScreen;
document.onfullscreenchange = () => {
  fullscreenBtn.textContent = document.fullscreenElement
    ? "fullscreen_exit"
    : "fullscreen";
};

video.addEventListener("dblclick", toggleFullScreen);

// Speed
video.onratechange = () => {
  speedControls.value = video.playbackRate.toFixed(2);
  updateTimeIndicator();
};

speedControls.onchange = () => {
  // Caused by keyboard shortcuts
  speedControls.value = Number.parseFloat(speedControls.value).toFixed(2);
  video.playbackRate = clamp(0.1, speedControls.value, 16);
};

// Zoom
zoomBtn.onclick = toggleZoom;

// Subtitles
if (subtitlesBtn) {
  subtitlesBtn.onclick = toggleSubtitles;
  subtitlesBtn.oncontextmenu = (e) => {
    e.preventDefault();
    pickSubtitleFile();
  };
}

subtitlePicker?.addEventListener("change", async (e) => {
  if (e.target.files?.length) {
    await loadSubtitleFile(e.target.files[0]);
    subtitlePicker.value = "";
  }
});

if (video.textTracks) {
  video.textTracks.addEventListener("change", updateSubtitlesBtnState);
  video.textTracks.addEventListener("addtrack", updateSubtitlesBtnState);
  video.textTracks.addEventListener("removetrack", updateSubtitlesBtnState);
}

// TIME
video.addEventListener("loadedmetadata", () => {
  if (localStorage.getItem(localStorageKey)) {
    restoreFromLocalStorage();
  }

  updateProgressBarValue();
  updateProgressBarVisually();
  updateTimeIndicator();
});

video.addEventListener("timeupdate", () => {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    return;
  }

  updateProgressBarValue();
  updateProgressBarVisually();
  updateTimeIndicator();
});

// Seek to the point clicked on the progress bar
progressBar.addEventListener("input", () => {
  video.currentTime = (progressBar.valueAsNumber * video.duration) / 100;

  // Needed to show the time in real-time when the progress bar is dragged
  updateProgressBarVisually();
  updateTimeIndicator();
});

function updateProgressBarValue() {
  progressBar.valueAsNumber = (video.currentTime * 100) / video.duration;
}

function updateProgressBarVisually() {
  progressBar.style.setProperty("--progress", `${progressBar.valueAsNumber}%`);
}

function updateTimeIndicator() {
  if (timeIndicatorToggle.dataset.state === "default") {
    timeIndicator.textContent = secondsToTime(video.currentTime);
    durationOrFinishAt.textContent = secondsToTime(video.duration);
  } else {
    timeLeft = video.duration - video.currentTime;
    timeIndicator.textContent = `${secondsToTime(timeLeft)} left`;

    currentTime = Date.now();
    durationOrFinishAt.textContent = `Finish at ${millisecondsToTimeOfDay(currentTime + (timeLeft * 1000) / video.playbackRate)}`;
  }
}

// progressBar also has tabindex="-1"
progressBar.onfocus = () => {
  progressBar.blur();
};

replayBtn.onclick = replay;
forwardBtn.onclick = forward;

timeIndicatorToggle.addEventListener("click", toggleTimeIndicator);

video.addEventListener("emptied", () => {
  // Needed when another video is loaded while the current one is playing
  playBtn.textContent = "play_arrow";
});

// Save time in local storage when the window is closed/refreshed
window.onbeforeunload = () => {
  if (video.src && !video.ended) {
    updateLocalStorage();
  }
};

// CLEANUP
for (const key of Object.keys(localStorage)) {
  if (!key.startsWith(LOCAL_STORAGE_NAMESPACE)) continue;
  const entryDate = new Date(JSON.parse(localStorage.getItem(key)).lastOpened);
  if (entryDate < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
    localStorage.removeItem(key);
  }
}

video.onended = () => {
  localStorage.removeItem(localStorageKey);
};

// KEYBOARD SHORTCUTS
document.addEventListener("keydown", (e) => {
  // Ignore key presses when a modifier key is pressed
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

  // Sometimes somehow when a button is pressed, an element is focused
  if (e.key !== " " && document.activeElement.tagName !== "INPUT") {
    document.activeElement.blur();
  }

  switch (e.key) {
    case " ": // Toggle play
    case "k":
      if (document.activeElement.tagName === "BUTTON") break;
      togglePlay();
      break;
    case "s": // Slow down
    case "S":
      speedControls.stepDown();
      speedControls.dispatchEvent(new Event("change"));
      break;
    case "d": // Speed up
    case "D":
      speedControls.stepUp();
      speedControls.dispatchEvent(new Event("change"));
      break;
    case "z": // Rewind
    case "Z":
    case "ArrowLeft":
    case "ArrowDown":
      if (document.activeElement.tagName !== "INPUT") replay();
      break;
    case "x": // Advance
    case "X":
    case "ArrowRight":
    case "ArrowUp":
      if (document.activeElement.tagName !== "INPUT") forward();
      break;
    case "r": // Reset speed
      video.playbackRate = video.defaultPlaybackRate;
      break;
    case "t": // Toggle time indicator
      toggleTimeIndicator();
      break;
    case "a": // Preferred fast speed
      video.playbackRate = preferences.speed;
      break;
    case "v": // Toggle subtitles
    case "V":
      toggleSubtitles();
      break;
    case "c": // Toggle zoom
      toggleZoom();
      break;
    case "p": // Toggle PiP
      togglePictureInPicture();
      break;
    case "f":
    case "Enter":
      if (
        document.activeElement.tagName !== "BUTTON" &&
        document.activeElement.tagName !== "INPUT"
      )
        toggleFullScreen();
  }
});

function togglePlay() {
  video.paused ? video.play() : video.pause();
}

function clamp(min, value, max) {
  return Math.min(Math.max(value, min), max);
}

function replay() {
  video.currentTime = Math.max(video.currentTime - preferences.timeSkip, 0);
}

function forward() {
  video.currentTime = Math.min(
    video.currentTime + preferences.timeSkip,
    video.duration,
  );
}

function togglePictureInPicture() {
  document.pictureInPictureElement
    ? document.exitPictureInPicture()
    : video.requestPictureInPicture();
}

function toggleFullScreen() {
  document.fullscreenElement
    ? document.exitFullscreen()
    : player.requestFullscreen();
}

function toggleZoom() {
  if (zoomBtn.textContent.trim() === "zoom_out_map") {
    video.style.objectFit = "cover";
    zoomBtn.textContent = "crop_free";
  } else {
    video.style.objectFit = "contain";
    zoomBtn.textContent = "zoom_out_map";
  }
}

function toggleTimeIndicator() {
  if (timeIndicatorToggle.dataset.state === "default") {
    timeIndicatorToggle.dataset.state = "alternate";
  } else {
    timeIndicatorToggle.dataset.state = "default";
  }
  updateTimeIndicator();
}

// Convert seconds to time in format (h:)mm:ss
// Use https://tc39.es/proposal-temporal/docs/duration.html when available
function secondsToTime(seconds) {
  return new Date(seconds * 1000)
    .toISOString()
    .substring(seconds >= 3600 ? 12 : 14, 19);
}

function millisecondsToTimeOfDay(milliseconds) {
  return new Date(milliseconds).toLocaleTimeString([], {
    timeStyle: "short",
  });
}

// UTILITIES
async function computeFileSignature(
  file,
  chunkSize = 1024 * 1024, // 1 MB
  algorithm = "SHA-1", // Prefer speed over security
) {
  // Get the first and last chunk of the file
  const firstPart = file.slice(0, chunkSize);
  const lastPart = file.slice(-chunkSize);

  // Read the file chunks as array buffers
  const chunksData = await Promise.all([
    firstPart.arrayBuffer(),
    lastPart.arrayBuffer(),
  ]);

  // Create a buffer for the file size
  const sizeBuffer = new ArrayBuffer(8);
  new DataView(sizeBuffer).setBigUint64(0, BigInt(file.size));

  // Concatenate the array buffers and the file size buffer
  const combined = new Uint8Array(
    chunksData[0].byteLength + chunksData[1].byteLength + sizeBuffer.byteLength,
  );
  combined.set(new Uint8Array(chunksData[0]), 0);
  combined.set(new Uint8Array(chunksData[1]), chunksData[0].byteLength);
  combined.set(sizeBuffer, chunksData[0].byteLength + chunksData[1].byteLength);

  // Hash the combined buffer
  const hash = await crypto.subtle.digest(algorithm, combined);

  // Convert the hash to a hex string
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function updateLocalStorage() {
  const hasShowingTrack =
    video.textTracks &&
    Array.from(video.textTracks).some((t) => t.mode === "showing");
  const state = {
    timer: video.currentTime,
    playbackRate: video.playbackRate,
    lastOpened: Date.now(),
    timeIndicator: timeIndicator.dataset.state,
    subtitlesShowing: hasShowingTrack,
  };
  localStorage.setItem(localStorageKey, JSON.stringify(state));
}

function restoreFromLocalStorage() {
  const state = JSON.parse(localStorage.getItem(localStorageKey));
  video.currentTime = state.timer;
  video.playbackRate = state.playbackRate;
  timeIndicator.dataset.state = state.timeIndicator;
  if (
    state.subtitlesShowing !== undefined &&
    video.textTracks &&
    video.textTracks.length > 0
  ) {
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = state.subtitlesShowing
        ? "showing"
        : "disabled";
    }
    updateSubtitlesBtnState();
  }
}
