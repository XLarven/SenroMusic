declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export function youtubeVideoId(track: { id: string; streamUrl: string }): string {
  return track.streamUrl.startsWith('youtube:') ? track.streamUrl.slice('youtube:'.length) : track.id.replace(/^yt_/, '');
}

export type YouTubeCallbacks = {
  onStateChange: (playing: boolean, buffering: boolean) => void;
  onTimeUpdate: (currentTime: number, duration: number) => void;
  onEnded: () => void;
  onError: (message: string, code?: number) => void;
  onReady: () => void;
};

let apiPromise: Promise<any> | null = null;
let player: any = null;
let playerContainer: HTMLElement | null = null;
let currentVideoId: string | null = null;
let callbacks: YouTubeCallbacks | null = null;
let timer: number | null = null;

function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

function startTimer() {
  if (timer !== null) return;
  timer = window.setInterval(() => {
    if (!player?.getCurrentTime || !callbacks) return;
    try {
      callbacks.onTimeUpdate(player.getCurrentTime(), player.getDuration());
    } catch {
      // Player may be destroyed.
    }
  }, 500);
}

function stopTimer() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

export async function playYouTubeVideo(
  videoId: string,
  container: HTMLElement,
  nextCallbacks: YouTubeCallbacks,
  options: { autoplay?: boolean; startTime?: number } = {},
): Promise<void> {
  callbacks = nextCallbacks;
  const YT = await loadYouTubeApi();
  if (player && currentVideoId === videoId && playerContainer === container) {
    try {
      if (options.startTime !== undefined) player.seekTo(options.startTime, true);
      if (options.autoplay) player.playVideo();
      else player.pauseVideo();
    } catch {
      // ignore
    }
    startTimer();
    return;
  }

  destroyYouTubePlayer();
  callbacks = nextCallbacks;
  playerContainer = container;
  currentVideoId = videoId;
  container.innerHTML = '';

  if (!container.id) container.id = 'norie-youtube-player';
  player = new YT.Player(container.id, {
    videoId,
    height: '100%',
    width: '100%',
    playerVars: {
      origin: window.location.origin,
      autoplay: options.autoplay ? 1 : 0,
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
    },
    events: {
      onReady: () => {
        try {
          if (options.startTime !== undefined) player.seekTo(options.startTime, true);
          if (options.autoplay) player.playVideo();
          else player.pauseVideo();
          player.setVolume(80);
        } catch {
          // ignore
        }
        callbacks?.onReady();
        startTimer();
      },
      onStateChange: (event: { data: number }) => {
        if (event.data === 1) callbacks?.onStateChange(true, false);
        else if (event.data === 3) callbacks?.onStateChange(true, true);
        else if (event.data === 2) callbacks?.onStateChange(false, false);
        else if (event.data === 0) callbacks?.onEnded();
      },
      onError: (event: { data?: number }) => {
        callbacks?.onError('YouTube oynatılamadı. Video kısıtlı veya gömülemez olabilir.', event?.data);
      },
    },
  });
}

export function destroyYouTubePlayer(): void {
  stopTimer();
  try {
    player?.destroy();
  } catch {
    // ignore
  }
  player = null;
  playerContainer = null;
  currentVideoId = null;
  callbacks = null;
}

export function youtubePlay(): void {
  try {
    player?.playVideo();
  } catch {
    // ignore
  }
}

export function youtubePause(): void {
  try {
    player?.pauseVideo();
  } catch {
    // ignore
  }
}

export function youtubeSeek(time: number): void {
  try {
    player?.seekTo(Math.max(0, time), true);
    callbacks?.onTimeUpdate(player.getCurrentTime(), player.getDuration());
  } catch {
    // ignore
  }
}

export function youtubeSetVolume(volume: number): void {
  try {
    player?.setVolume(Math.max(0, Math.min(100, volume * 100)));
  } catch {
    // ignore
  }
}

export function youtubeSetMuted(muted: boolean): void {
  try {
    if (muted) player?.mute();
    else player?.unMute();
  } catch {
    // ignore
  }
}
