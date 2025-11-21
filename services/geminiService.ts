import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Scene, Story, VoiceName, AspectRatio } from "../types";
import { decodeBase64 } from "./audioUtils";

// Initialize client
// Use a function to get the key to ensure it's picked up from env
const getApiKey = () => process.env.API_KEY || '';
const getClient = () => new GoogleGenAI({ apiKey: getApiKey() });

export const generateStoryStructure = async (topic: string, aspectRatio: AspectRatio): Promise<Omit<Story, 'id' | 'createdAt' | 'aspectRatio'>> => {
  const ai = getClient();
  
  const orientationDesc = aspectRatio === '16:9' ? "wide shot, cinematic" : "vertical, portrait mode, mobile wallpaper style";

  const prompt = `
    为5-8岁的儿童创作一个关于历史故事"${topic}"的**脱口秀风格**讲解脚本。
    
    风格要求：
    1. **脱口秀/单口相声风格**：不要用刻板的“很久很久以前”，要用第一人称“我”或者“本喵/本大王”来讲述。
    2. **幽默风趣**：加入一些**无伤大雅的现代梗**、网络流行语（如“破防了”、“真香”、“yyds”等适合孩子理解的词），让历史人物变得接地气。
    3. **互动感**：像是在对着观众演讲，多用反问句和感叹句。
    4. **情节生动**：虽然是搞笑风格，但核心历史事实要准确。
    
    结构要求：
    包含标题、一段爆笑的开场白（introduction），以及12个具体的场景。
    每个场景需要：
    - narration: 一段适合朗读的**中文**旁白，要在100字以内，口语化，带梗。
    - visual_prompt: 用于生成画面的**英文**提示词。必须包含: children's book illustration, ${aspectRatio} aspect ratio, ${orientationDesc}, vibrant colors, cute characters, 3d style, detailed background.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "The title of the story" },
            introduction: { type: Type.STRING, description: "A humorous, stand-up comedy style intro" },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER, description: "Scene sequence number" },
                  narration: { type: Type.STRING, description: "Humorous talk-show style voiceover text in Chinese" },
                  visual_prompt: { type: Type.STRING, description: `Image generation prompt in English, ${aspectRatio} ratio` }
                },
                required: ["id", "narration", "visual_prompt"],
                propertyOrdering: ["id", "narration", "visual_prompt"]
              }
            }
          },
          required: ["title", "introduction", "scenes"],
          propertyOrdering: ["title", "introduction", "scenes"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("生成故事结构失败: 响应为空");
    
    const parsed = JSON.parse(text);
    if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
        throw new Error("生成故事结构失败: 场景数据缺失");
    }
    return parsed;

  } catch (error) {
    console.error("Story structure generation failed:", error);
    throw new Error("故事生成失败，请稍后再试");
  }
};

export const generateSceneImage = async (prompt: string, aspectRatio: AspectRatio): Promise<string> => {
  const ai = getClient();
  
  const finalPrompt = `${prompt}, ${aspectRatio} aspect ratio, cinematic lighting, high resolution`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image', // Nano Banana
      contents: {
        parts: [
          { text: finalPrompt }
        ]
      },
      config: {
        responseModalities: [Modality.IMAGE],
      }
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData && part.inlineData.data) {
      return part.inlineData.data;
    }
    throw new Error("Image generation returned no data");
  } catch (error) {
    console.error("Image generation failed:", error);
    throw error; 
  }
};

export const generateCoverImage = async (topic: string, aspectRatio: AspectRatio, count: number = 4): Promise<string[]> => {
  const ai = getClient();
  
  const orientationDesc = aspectRatio === '16:9' ? "wide cinematic landscape" : "vertical mobile wallpaper";

  // Prompt optimization: Removed "movie poster" to avoid text generation.
  // Strictly enforces NO TEXT in the output so we can add it programmatically.
  const prompt = `
    Create a high-quality 3D animated illustration for a children's history story about "${topic}".
    Format: ${orientationDesc}.
    Style: High-quality 3D render, cute, vibrant colors, soft lighting, detailed textures, Pixar-style.
    Content: A key character or scene representing "${topic}". Magical and engaging.
    Composition: Clean composition with some negative space for overlay text.
    Crucial Constraint: NO TEXT, NO TITLES, NO WORDS, NO LETTERS in the image. Pure artwork only.
  `;

  try {
      // Try Imagen 3 (via version 4.0 endpoint) for higher quality
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
            numberOfImages: count,
            aspectRatio: aspectRatio,
            outputMimeType: 'image/jpeg'
        }
      });
      
      const images = response.generatedImages?.map(img => img.image?.imageBytes).filter(Boolean) as string[];
      if (images && images.length > 0) return images;
      throw new Error("No images generated from Imagen");

  } catch (e) {
      console.log("Imagen failed, falling back to flash-image", e);
      
      // Fallback to flash-image (Nano Banana). 
      // Since it doesn't support numberOfImages, we make parallel requests or just one loop if count > 1.
      const variations = [
          "close-up shot",
          "wide angle shot",
          "side view",
          "dynamic action shot"
      ].slice(0, count);

      // If count is 1, just use one prompt
      const promptsToRun = count === 1 ? [`${prompt}, ${aspectRatio} aspect ratio`] : variations.map(v => `${prompt}, ${v}, ${aspectRatio} aspect ratio`);

      try {
          const promises = promptsToRun.map(p => 
            ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [{ text: p }] },
                config: { responseModalities: [Modality.IMAGE] }
            })
          );

          const responses = await Promise.all(promises);
          const images = responses
            .map(res => res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data)
            .filter((data): data is string => !!data);

          if (images.length > 0) return images;
          throw e;

      } catch (fallbackError) {
          console.error("Fallback generation failed", fallbackError);
          throw fallbackError;
      }
  }
};

/**
 * Ensures Veo API Key is available. Returns true if ready, false/throws if failed.
 */
export const checkVeoSetup = async (): Promise<boolean> => {
    const aistudio = (window as any).aistudio;
    if (aistudio) {
        try {
            const hasKey = await aistudio.hasSelectedApiKey();
            if (!hasKey) {
                await aistudio.openSelectKey();
                // Double check after dialog close (race condition mitigation handled by just proceeding usually, 
                // but here we just open it)
                return true; // Assuming user interacts
            }
            return true;
        } catch (e) {
            console.error("Failed to check/open API key dialog", e);
            return false;
        }
    }
    return true; // If aistudio object missing, assumes running in env where key is injected or not controlled this way
};

export const generateVeoScene = async (prompt: string, aspectRatio: AspectRatio, imageBase64?: string): Promise<string | null> => {
    // Proactive check
    await checkVeoSetup();

    const executeGeneration = async (): Promise<string | null> => {
        // Always create a fresh client to ensure latest API key is used
        const ai = getClient();
        const key = getApiKey();

        // Veo 3.1 Fast Preview
        const model = 'veo-3.1-fast-generate-preview';
        
        let operation;
        // Clean base64 prefix if present
        const base64Data = imageBase64?.replace(/^data:image\/\w+;base64,/, "");
        
        // Veo resolution config
        const res = '720p'; 

        if (base64Data) {
             operation = await ai.models.generateVideos({
                model: model,
                prompt: prompt, 
                image: {
                    imageBytes: base64Data,
                    mimeType: 'image/jpeg' 
                },
                config: {
                    numberOfVideos: 1,
                    resolution: res,
                    aspectRatio: aspectRatio 
                }
            });
        } else {
            operation = await ai.models.generateVideos({
                model: model,
                prompt: prompt,
                config: {
                    numberOfVideos: 1,
                    resolution: res,
                    aspectRatio: aspectRatio
                }
            });
        }
        
        // Poll for completion
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }
        
        const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (uri) {
            // Fetch the actual video bytes using the key
            const vidResponse = await fetch(`${uri}&key=${key}`);
            if (!vidResponse.ok) throw new Error("Failed to download video bytes");
            const blob = await vidResponse.blob();
            return URL.createObjectURL(blob);
        }
        return null;
    };

    try {
        return await executeGeneration();
    } catch (e: any) {
        // Handle specific Veo 404 error: "Requested entity was not found."
        const errorMsg = e.message || JSON.stringify(e);
        if (errorMsg.includes("Requested entity was not found") || errorMsg.includes("404")) {
            const aistudio = (window as any).aistudio;
            if (aistudio) {
                console.log("Veo entity not found (key missing?), requesting key selection...");
                await aistudio.openSelectKey();
                // Retry once with the new key
                return await executeGeneration();
            }
        }

        console.error("Veo generation failed", e);
        return null;
    }
};

export const generateVeoTransition = async (startImageB64: string, endImageB64: string, aspectRatio: AspectRatio): Promise<string | null> => {
    await checkVeoSetup();
    
    const executeGeneration = async (): Promise<string | null> => {
        const ai = getClient();
        const key = getApiKey();
        const model = 'veo-3.1-fast-generate-preview';
        
        const startBytes = startImageB64.replace(/^data:image\/\w+;base64,/, "");
        const endBytes = endImageB64.replace(/^data:image\/\w+;base64,/, "");

        let operation = await ai.models.generateVideos({
            model: model,
            prompt: "Smooth cinematic morphing transition between these two scenes", // Optional prompt
            image: {
                imageBytes: startBytes,
                mimeType: 'image/jpeg'
            },
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: aspectRatio,
                lastFrame: {
                    imageBytes: endBytes,
                    mimeType: 'image/jpeg'
                }
            }
        });

        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (uri) {
            const vidResponse = await fetch(`${uri}&key=${key}`);
            if (!vidResponse.ok) throw new Error("Failed to download transition video bytes");
            const blob = await vidResponse.blob();
            return URL.createObjectURL(blob);
        }
        return null;
    };

    try {
        return await executeGeneration();
    } catch (e: any) {
        const errorMsg = e.message || JSON.stringify(e);
        if (errorMsg.includes("Requested entity was not found") || errorMsg.includes("404")) {
             const aistudio = (window as any).aistudio;
             if (aistudio) {
                await aistudio.openSelectKey();
                return await executeGeneration();
             }
        }
        console.error("Veo transition generation failed", e);
        return null;
    }
};

export const generateVoiceover = async (text: string, voice: VoiceName): Promise<ArrayBuffer> => {
  const ai = getClient();
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("Audio generation returned no data");

    return decodeBase64(base64Audio).buffer;
  } catch (error) {
    console.error("Voiceover generation failed:", error);
    throw error;
  }
};

export const generateRecommendedTopics = async (): Promise<string[]> => {
  const ai = getClient();
  const prompt = `
    请推荐 4 个适合 5-8 岁儿童的中国历史典故、神话传说或成语故事。
    要求：
    1. 知名度高，趣味性强，有教育意义。
    2. 只要标题，不要解释。
    3. 随机一点，每次尝试推荐不同的。
    4. 返回 JSON 字符串数组格式。
    例如: ["草船借箭", "孔融让梨", "大闹天宫", "女娲补天"]
  `;

  const defaultTopics = ["草船借箭", "孔融让梨", "大闹天宫", "哪吒闹海"];

  try {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        }
    });

    const text = response.text;
    if (!text) return defaultTopics;
    
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.slice(0, 4); // Ensure max 4
        }
        return defaultTopics;
    } catch (e) {
        return defaultTopics;
    }
  } catch (error) {
    // Silent fail to default topics to prevent UI crash
    console.warn("Failed to fetch topics, using defaults:", error);
    return defaultTopics;
  }
};