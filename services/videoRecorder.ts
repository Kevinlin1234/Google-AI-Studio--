import { Story, Scene } from '../types';
import { decodeAudioData } from './audioUtils';

type VisualAsset = HTMLImageElement | HTMLVideoElement;

export const generateStoryVideo = async (
  story: Story,
  onProgress: (progress: number, status: string) => void,
  customCover?: string
): Promise<Blob> => {
  
  const isVertical = story.aspectRatio === '9:16';
  const width = isVertical ? 720 : 1280;
  const height = isVertical ? 1280 : 720;
  const FPS = 30; 
  const FRAME_INTERVAL = 1000 / FPS;
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Fill black initially
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();
  
  // Setup Stream & Recorder
  const stream = canvas.captureStream(FPS); 
  const audioTrack = dest.stream.getAudioTracks()[0];
  if (audioTrack) {
    stream.addTrack(audioTrack);
  }
  
  const chunks: Blob[] = [];
  
  // Try strict MP4 first, then WebM
  let mimeType = 'video/webm';
  if (MediaRecorder.isTypeSupported('video/mp4; codecs=avc1,mp4a.40.2')) {
    mimeType = 'video/mp4; codecs=avc1,mp4a.40.2';
  } else if (MediaRecorder.isTypeSupported('video/mp4')) {
    mimeType = 'video/mp4';
  } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
    mimeType = 'video/webm; codecs=vp9';
  }

  console.log(`Exporting video using mimeType: ${mimeType}`);

  const recorder = new MediaRecorder(stream, { 
      mimeType, 
      videoBitsPerSecond: 8000000 // 8 Mbps
  }); 
  
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();

  try {
    // 0. Pre-load Cover Image (Use custom if provided, else story default)
    let coverAsset: HTMLImageElement | null = null;
    const coverB64 = customCover || story.coverImage;

    if (coverB64) {
        onProgress(0, "正在加载封面...");
        coverAsset = new Image();
        await new Promise<void>(resolve => {
            if (!coverAsset) return resolve();
            coverAsset.onload = () => resolve();
            coverAsset.onerror = () => resolve();
            coverAsset.src = `data:image/jpeg;base64,${coverB64}`;
        });
    }

    // 1. Pre-load all assets (Images and Videos and Transition Videos)
    const visualAssets: VisualAsset[] = [];
    const transitionAssets: (HTMLVideoElement | null)[] = [];
    
    for (let i = 0; i < story.scenes.length; i++) {
       onProgress((i / story.scenes.length) * 20, `正在加载资源 ${i + 1}...`);
       const scene = story.scenes[i];

       // Load Scene Video/Image
       if (scene.videoUrl) {
           const vid = await loadVideo(scene.videoUrl);
           if (vid) visualAssets.push(vid);
           else {
               const img = await loadImage(scene.imageData!);
               visualAssets.push(img);
           }
       } else {
           const img = await loadImage(scene.imageData!);
           visualAssets.push(img);
       }

       // Load Transition Video if exists
       if (scene.transitionVideoUrl) {
           const tVid = await loadVideo(scene.transitionVideoUrl);
           transitionAssets.push(tVid); // Could be null
       } else {
           transitionAssets.push(null);
       }
    }

    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    // --- INTRO SEQUENCE (Cover) ---
    if (coverAsset) {
        const introDuration = 3.0;
        const introStartTime = audioCtx.currentTime;
        
        while (true) {
            const now = audioCtx.currentTime;
            const elapsed = now - introStartTime;
            
            if (elapsed >= introDuration) break;

            const progress = elapsed / introDuration;
            
            ctx.clearRect(0, 0, width, height);
            
            // Gentle Zoom on Cover
            const scale = 1.0 + (progress * 0.05);
            drawAsset(ctx, coverAsset, width, height, scale);
            
            // Fade In (start) and Fade Out (end)
            let opacity = 1;
            if (elapsed < 0.5) opacity = elapsed / 0.5;
            if (elapsed > introDuration - 0.5) opacity = (introDuration - elapsed) / 0.5;
            
            if (opacity < 1) {
                ctx.fillStyle = `rgba(0,0,0,${1 - opacity})`;
                ctx.fillRect(0, 0, width, height);
            }

            await new Promise(r => setTimeout(r, FRAME_INTERVAL));
        }
        // Short black pause
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        await new Promise(r => setTimeout(r, 300));
    }

    // --- MAIN STORY LOOP ---
    for (let i = 0; i < story.scenes.length; i++) {
      const scene = story.scenes[i];
      const currentAsset = visualAssets[i];
      const nextAsset = visualAssets[i + 1]; 
      const transitionVideo = transitionAssets[i];

      onProgress(20 + (i / story.scenes.length) * 70, `正在录制场景 ${i + 1}...`);

      // Prepare Audio
      let audioBuffer: AudioBuffer | null = null;
      if (scene.audioData) {
        try {
          audioBuffer = await decodeAudioData(new Uint8Array(scene.audioData.slice(0)), audioCtx);
        } catch (e) {
          console.error("Audio decode failed", e);
        }
      }

      // Calculate duration
      const duration = Math.max(audioBuffer ? audioBuffer.duration : 3.0, 2.0); 
      
      // Play TTS Audio
      let source: AudioBufferSourceNode | null = null;
      if (audioBuffer) {
          source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(dest);
          source.start();
      }

      // Start Video Playback if applicable
      if (currentAsset instanceof HTMLVideoElement) {
          currentAsset.currentTime = 0;
          await currentAsset.play();
      }

      const sceneStartTime = audioCtx.currentTime;
      
      // --- RENDER LOOP ---
      while (true) {
        const now = audioCtx.currentTime;
        const elapsed = now - sceneStartTime;
        
        if (elapsed >= duration) break;

        const progress = elapsed / duration;
        
        // Clear
        ctx.clearRect(0, 0, width, height);

        // Draw Visual
        if (currentAsset instanceof HTMLVideoElement) {
            drawAsset(ctx, currentAsset, width, height, 1.0);
        } else {
            // Draw Image with Ken Burns
            const zoomDirection = i % 2 === 0 ? 1 : -1;
            const scaleBase = 1.1;
            const scaleVar = 0.15;
            const currentScale = zoomDirection === 1 
                ? scaleBase + (scaleVar * progress) 
                : (scaleBase + scaleVar) - (scaleVar * progress);
            
            const breathing = Math.sin(elapsed * 2) * 0.005; 
            drawAsset(ctx, currentAsset, width, height, currentScale + breathing);
        }
        
        // Draw Subtitles
        const textOpacity = Math.min(elapsed * 2, 1);
        drawSubtitles(ctx, scene.narration, width, height, textOpacity);

        await new Promise(r => setTimeout(r, FRAME_INTERVAL));
      }
      
      // Stop Current Scene Audio
      if (source) {
        try { source.stop(); } catch(e) {}
      }

      // --- TRANSITION ---
      if (nextAsset) {
         if (transitionVideo) {
             // Use generated Veo transition video
             const tDuration = transitionVideo.duration || 2.0;
             const tStartTime = audioCtx.currentTime;
             
             transitionVideo.currentTime = 0;
             await transitionVideo.play();

             while (true) {
                 const now = audioCtx.currentTime;
                 const tElapsed = now - tStartTime;
                 if (tElapsed >= tDuration) break;

                 drawAsset(ctx, transitionVideo, width, height, 1.0);
                 await new Promise(r => setTimeout(r, FRAME_INTERVAL));
             }
         } else {
             // Fallback: Standard Canvas Transition
             const transitionDuration = 1.0;
             const transStartTime = audioCtx.currentTime;
             
             // Start next video early if needed
             if (nextAsset instanceof HTMLVideoElement) {
                 nextAsset.currentTime = 0;
                 nextAsset.play();
             }

             while (true) {
                const now = audioCtx.currentTime;
                const tElapsed = now - transStartTime;
                const tProgress = tElapsed / transitionDuration;
                
                if (tProgress >= 1) break;

                // Ease In Out Cubic
                const ease = tProgress < 0.5 
                    ? 4 * tProgress * tProgress * tProgress 
                    : 1 - Math.pow(-2 * tProgress + 2, 3) / 2;

                drawCinematicTransition(ctx, currentAsset, nextAsset, width, height, ease);
                
                await new Promise(r => setTimeout(r, FRAME_INTERVAL));
             }
         }
         
         // Pause previous video to save resources
         if (currentAsset instanceof HTMLVideoElement) {
             currentAsset.pause();
         }
      }
    }

    // --- OUTRO ---
    onProgress(99, "正在完成视频...");
    const lastAsset = visualAssets[visualAssets.length - 1];
    const fadeDuration = 1.5;
    const fadeStartTime = audioCtx.currentTime;

    while (true) {
        const now = audioCtx.currentTime;
        const tElapsed = now - fadeStartTime;
        const progress = tElapsed / fadeDuration;

        if (progress >= 1) break;

        if (lastAsset instanceof HTMLVideoElement) {
             drawAsset(ctx, lastAsset, width, height, 1.0);
        } else {
             drawAsset(ctx, lastAsset as HTMLImageElement, width, height, 1.25 + (progress * 0.05));
        }

        ctx.fillStyle = `rgba(0,0,0,${progress})`;
        ctx.fillRect(0, 0, width, height);

        await new Promise(r => setTimeout(r, FRAME_INTERVAL));
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    await new Promise(r => setTimeout(r, 500));

  } catch (err) {
    console.error("Video generation error", err);
    throw err;
  } finally {
    recorder.stop();
    audioCtx.close();
  }
  
  return new Promise<Blob>(resolve => {
    recorder.onstop = () => {
        // Trust the recorder's data
        const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
        resolve(blob);
    };
  });
};

// Helpers
async function loadVideo(url: string): Promise<HTMLVideoElement | null> {
   const vid = document.createElement('video');
   vid.crossOrigin = 'anonymous';
   vid.src = url;
   vid.muted = true;
   vid.playsInline = true;
   vid.preload = 'auto';
   vid.loop = false; // Transitions don't loop usually
   
   return new Promise<HTMLVideoElement | null>((resolve) => {
       vid.onloadeddata = () => resolve(vid);
       vid.onerror = () => resolve(null);
       setTimeout(() => resolve(null), 5000); // timeout
   });
}

async function loadImage(b64: string): Promise<HTMLImageElement> {
    const img = new Image();
    return new Promise<HTMLImageElement>((resolve) => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img); // Should not happen but preventing stall
        img.src = `data:image/png;base64,${b64}`;
    });
}

function drawAsset(
    ctx: CanvasRenderingContext2D, 
    asset: VisualAsset, 
    w: number, 
    h: number, 
    scale: number
) {
    const isVideo = asset instanceof HTMLVideoElement;
    const assetW = isVideo ? (asset as HTMLVideoElement).videoWidth : (asset as HTMLImageElement).width;
    const assetH = isVideo ? (asset as HTMLVideoElement).videoHeight : (asset as HTMLImageElement).height;
    
    if (assetW === 0 || assetH === 0) return;

    const assetRatio = assetW / assetH;
    const canvasRatio = w / h;
    
    let renderW, renderH;
    
    // Cover fit
    if (assetRatio > canvasRatio) {
        renderH = h;
        renderW = h * assetRatio;
    } else {
        renderW = w;
        renderH = w / assetRatio;
    }

    renderW *= scale;
    renderH *= scale;

    const x = (w - renderW) / 2;
    const y = (h - renderH) / 2;

    ctx.drawImage(asset, x, y, renderW, renderH);
}


function drawCinematicTransition(
    ctx: CanvasRenderingContext2D, 
    assetA: VisualAsset, 
    assetB: VisualAsset, 
    w: number, 
    h: number, 
    progress: number
) {
    ctx.clearRect(0, 0, w, h);
    
    const offsetX = w * progress; 
    
    // Draw A
    ctx.save();
    ctx.translate(-offsetX, 0);
    const scaleA = assetA instanceof HTMLVideoElement ? 1.0 : 1.25;
    drawAsset(ctx, assetA, w, h, scaleA);
    
    ctx.fillStyle = `rgba(0,0,0,${progress * 0.5})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Draw B
    ctx.save();
    ctx.translate(w - offsetX, 0);
    const scaleB = assetB instanceof HTMLVideoElement ? 1.0 : 1.1;
    drawAsset(ctx, assetB, w, h, scaleB);
    
    ctx.shadowColor = "black";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetX = -20;
    ctx.fillRect(-5, 0, 5, h);
    
    ctx.restore();
}


function drawSubtitles(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, opacity: number) {
  const isVertical = h > w;
  const fontSize = isVertical ? 40 : 36;
  const padding = 24;
  const bottomMargin = isVertical ? 150 : 60;
  
  ctx.font = `900 ${fontSize}px "Zcool KuaiLe", "Nunito", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const maxWidth = w - (padding * 4);
  const words = text.split('');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + word).width;
    if (width < maxWidth) {
      currentLine += word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);

  const lineHeight = fontSize * 1.4;
  const totalTextHeight = lines.length * lineHeight;
  const bgHeight = totalTextHeight + (padding * 2);
  
  ctx.save();
  ctx.globalAlpha = opacity;

  const bgY = h - bgHeight - bottomMargin;
  const gradient = ctx.createLinearGradient(0, bgY, 0, h - bottomMargin);
  gradient.addColorStop(0, 'rgba(0,0,0,0.4)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.8)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, h - bgHeight - bottomMargin - 20, w, bgHeight + 40);

  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  lines.forEach((line, index) => {
    const y = h - bottomMargin - padding - ((lines.length - 1 - index) * lineHeight);
    ctx.fillText(line, w / 2, y);
  });
  
  ctx.restore();
}