export interface Scene {
  id: number;
  narration: string;
  visual_prompt: string;
  imageData?: string; // Base64
  audioData?: ArrayBuffer; // Raw PCM
  videoUrl?: string; // Blob URL for Veo video (Scene content)
  transitionVideoUrl?: string; // Blob URL for Veo video (Transition to next scene)
}

export type AspectRatio = '16:9' | '9:16';

export interface Story {
  id: string;
  title: string;
  introduction: string;
  scenes: Scene[];
  createdAt: number;
  aspectRatio: AspectRatio;
  coverImage?: string; // Base64 image with title composition
}

export enum VoiceName {
  Puck = 'Puck',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Charon = 'Charon',
  Aoede = 'Aoede' 
}

export interface AppState {
  currentStory: Story | null;
  savedStories: Story[];
  isLoading: boolean;
  loadingStep: string;
  selectedVoice: VoiceName;
  selectedAspectRatio: AspectRatio;
  isImmersive: boolean;
}