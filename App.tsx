import React, { useState, useEffect } from 'react';
import { AppState, Story, VoiceName, Scene, AspectRatio } from './types';
import { generateStoryStructure, generateSceneImage, generateVoiceover, generateRecommendedTopics, generateCoverImage } from './services/geminiService';
import { addTitleToCover } from './services/imageProcessor';
import { StoryPlayer } from './components/StoryPlayer';
import { Button } from './components/Button';
import { VoiceSelector } from './components/VoiceSelector';
import { BookOpen, History as HistoryIcon, Sparkles, ArrowRight, Trash2, Map, Monitor, Smartphone, RefreshCw, Image as ImageIcon, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function App() {
  const [state, setState] = useState<AppState>({
    currentStory: null,
    savedStories: [],
    isLoading: false,
    loadingStep: '',
    selectedVoice: VoiceName.Puck,
    selectedAspectRatio: '16:9',
    isImmersive: false,
  });

  const [topicInput, setTopicInput] = useState('');
  const [recommendedTopics, setRecommendedTopics] = useState<string[]>([]);
  const [isTopicsLoading, setIsTopicsLoading] = useState(false);

  // Cover Gen State
  const [mode, setMode] = useState<'story' | 'cover'>('story');
  const [coverImages, setCoverImages] = useState<string[]>([]);
  const [isCoverLoading, setIsCoverLoading] = useState(false);

  const handleRefreshTopics = async () => {
    if (isTopicsLoading) return;
    setIsTopicsLoading(true);
    try {
        const topics = await generateRecommendedTopics();
        // Ensure we have an array
        if (Array.isArray(topics) && topics.length > 0) {
            setRecommendedTopics(topics);
        } else {
            setRecommendedTopics(['三顾茅庐', '郑和下西洋', '长城的故事', '花木兰']);
        }
    } catch (e) {
        console.warn("Topics fetch error in UI", e);
        setRecommendedTopics(['三顾茅庐', '郑和下西洋', '长城的故事', '花木兰']);
    } finally {
        setIsTopicsLoading(false);
    }
  };

  // Load stories from local storage on mount and init topics
  useEffect(() => {
    // Init with static defaults first to show something immediately
    setRecommendedTopics(['三顾茅庐', '郑和下西洋', '长城的故事', '花木兰']);
    // Then try to fetch fresh ones
    handleRefreshTopics();

    const saved = localStorage.getItem('history_magic_stories');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migrate old stories to have a default aspect ratio if missing
        const migrated = parsed.map((s: any) => ({
            ...s,
            aspectRatio: s.aspectRatio || '16:9'
        }));
        setState(s => ({ ...s, savedStories: migrated }));
      } catch (e) {
        console.error("Failed to load stories", e);
      }
    }
  }, []);

  const saveStoryToStorage = (story: Story) => {
    const newSaved = [story, ...state.savedStories].slice(0, 2); 
    setState(s => ({ ...s, savedStories: newSaved }));
    try {
        const storiesToSave = newSaved.map(s => ({
            ...s,
            scenes: s.scenes.map(scene => ({
                ...scene,
                audioData: undefined,
                videoUrl: undefined // Don't save blob URLs as they expire
            }))
        }));
        localStorage.setItem('history_magic_stories', JSON.stringify(storiesToSave));
    } catch (e) {
        alert("Storage full! Old stories might be overwritten.");
    }
  };

  const handleDeleteStory = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const newSaved = state.savedStories.filter(s => s.id !== id);
      setState(s => ({ ...s, savedStories: newSaved }));
      localStorage.setItem('history_magic_stories', JSON.stringify(newSaved));
  };

  const handleGenerate = async () => {
    if (!topicInput.trim()) return;

    setState(s => ({ ...s, isLoading: true, loadingStep: '正在构思历史故事...' }));

    try {
      // 1. Generate Text Structure
      const structure = await generateStoryStructure(topicInput, state.selectedAspectRatio);
      
      // 1.5 Append Outro Scene
      const outroScene = {
          id: structure.scenes.length + 1,
          narration: "如果故事讲的不错，能不能给个一键三连！如果你还想听其他的历史故事，请在评论区留言告诉我们！",
          visual_prompt: "cute ending scene, theatrical curtain call, children waving goodbye, warm cozy lighting, detailed background, magical atmosphere"
      };
      structure.scenes.push(outroScene);

      setState(s => ({ ...s, loadingStep: `准备生成 ${structure.scenes.length} 个场景的素材...` }));
      
      // 2. Generate Assets
      const scenesWithAssets: Scene[] = [];
      
      for (let i = 0; i < structure.scenes.length; i++) {
        const scene = structure.scenes[i];
        
        setState(s => ({ ...s, loadingStep: `正在绘制历史场景 (${i + 1}/${structure.scenes.length})...` }));
        // Generate Image with correct Aspect Ratio
        let imageData;
        try {
            imageData = await generateSceneImage(scene.visual_prompt, state.selectedAspectRatio);
        } catch (e) {
            console.error("Scene image failed", e);
        }
        
        setState(s => ({ ...s, loadingStep: `正在录制旁白 (${i + 1}/${structure.scenes.length})...` }));
        // Generate Audio
        let audioData;
        try {
            audioData = await generateVoiceover(scene.narration, state.selectedVoice);
        } catch (e) {
            console.error("Scene audio failed", e);
        }

        scenesWithAssets.push({
          ...scene,
          imageData,
          audioData
        });
      }

      // 3. Auto Generate Cover Image
      setState(s => ({ ...s, loadingStep: '正在绘制精美封面...' }));
      let finalCoverImage: string | undefined = undefined;
      try {
        // Generate only 1 image for speed
        const [rawCover] = await generateCoverImage(structure.title, state.selectedAspectRatio, 1);
        if (rawCover) {
            // Composite title
            finalCoverImage = await addTitleToCover(rawCover, structure.title, state.selectedAspectRatio);
        }
      } catch (e) {
          console.warn("Auto cover generation failed", e);
      }

      const newStory: Story = {
        id: Date.now().toString(),
        title: structure.title,
        introduction: structure.introduction,
        scenes: scenesWithAssets,
        createdAt: Date.now(),
        aspectRatio: state.selectedAspectRatio,
        coverImage: finalCoverImage
      };

      saveStoryToStorage(newStory);
      setState(s => ({ ...s, currentStory: newStory, isLoading: false }));

    } catch (error) {
      console.error(error);
      alert("生成故事时遇到了一点小问题，请重试！");
      setState(s => ({ ...s, isLoading: false }));
    }
  };

  const handleGenerateCover = async () => {
      if (!topicInput.trim()) return;
      setIsCoverLoading(true);
      setCoverImages([]);
      
      try {
          // 1. Generate 4 base images
          const rawImages = await generateCoverImage(topicInput, state.selectedAspectRatio, 4);
          
          // 2. Composite title text onto all images
          const processedPromises = rawImages.map(img => 
              addTitleToCover(img, topicInput, state.selectedAspectRatio)
          );
          
          const finalImages = await Promise.all(processedPromises);
          
          setCoverImages(finalImages);
      } catch (e) {
          console.error("Cover generation failed", e);
          alert("封面生成失败，请重试");
      } finally {
          setIsCoverLoading(false);
      }
  };

  const downloadCover = (imageData: string, index: number) => {
      const link = document.createElement('a');
      link.href = `data:image/jpeg;base64,${imageData}`;
      link.download = `cover-${topicInput}-${index + 1}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const playSavedStory = (story: Story) => {
    setState(s => ({ ...s, currentStory: story, selectedAspectRatio: story.aspectRatio }));
  };

  // ---------------- RENDER ----------------

  if (state.currentStory) {
    return (
      <StoryPlayer 
        story={state.currentStory} 
        onBack={() => setState(s => ({ ...s, currentStory: null, isImmersive: false }))}
        isImmersive={state.isImmersive}
        toggleImmersive={() => setState(s => ({ ...s, isImmersive: !s.isImmersive }))}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-100 via-indigo-50 to-amber-100 p-4 sm:p-8 md:p-12 font-sans">
      
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between mb-8 md:mb-12">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-400 rounded-2xl shadow-lg text-white">
               <HistoryIcon size={32} />
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-slate-800 tracking-tight">
              HistoryMagic <span className="text-amber-500">时光机</span>
            </h1>
          </div>
          <div className="hidden md:block text-slate-500 font-medium">
            探索历史的奇妙旅程
          </div>
        </header>

        <div className="grid md:grid-cols-12 gap-8">
          
          {/* Main Input Area */}
          <div className="md:col-span-7 space-y-6">
            <section className="bg-white p-1 rounded-[2.5rem] shadow-xl border-2 border-white/50 backdrop-blur-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                 <Sparkles size={120} />
              </div>

              {/* Mode Switcher Tabs */}
              <div className="flex p-2 bg-slate-100/50 rounded-[2.2rem] mb-2 relative z-10">
                  <button 
                    onClick={() => setMode('story')}
                    className={`flex-1 py-3 px-6 rounded-3xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                        mode === 'story' 
                        ? 'bg-white text-indigo-600 shadow-md' 
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                      <BookOpen size={20} /> 故事模式
                  </button>
                  <button 
                    onClick={() => setMode('cover')}
                    className={`flex-1 py-3 px-6 rounded-3xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                        mode === 'cover' 
                        ? 'bg-white text-amber-600 shadow-md' 
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                      <ImageIcon size={20} /> 封面工坊
                  </button>
              </div>

              <div className="p-6 md:p-8 pt-2 relative z-10">
                {mode === 'story' ? (
                    // --- STORY MODE ---
                    <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <h2 className="text-2xl font-bold text-slate-700 mb-4">你想听什么故事？</h2>
                        <p className="text-slate-500 mb-6">输入一个历史事件、人物或成语，比如 "草船借箭" 或 "孔融让梨"</p>
                    </motion.div>
                ) : (
                    // --- COVER MODE ---
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <h2 className="text-2xl font-bold text-slate-700 mb-4">制作视频封面</h2>
                        <p className="text-slate-500 mb-6">为你的历史故事生成 4 张精美的封面图，自动为您配上标题。</p>
                    </motion.div>
                )}
                
                <div className="space-y-6">
                    <div>
                        <input
                            type="text"
                            value={topicInput}
                            onChange={(e) => setTopicInput(e.target.value)}
                            placeholder={mode === 'story' ? "输入历史典故..." : "输入封面主题..."}
                            className="w-full p-5 text-lg rounded-2xl bg-slate-50 border-2 border-slate-200 focus:border-amber-400 focus:ring-4 focus:ring-amber-100 outline-none transition-all placeholder:text-slate-300"
                            disabled={state.isLoading || isCoverLoading}
                        />
                    
                        {/* Sample Prompts */}
                        <div className="flex flex-wrap gap-2 mt-3 items-center">
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1 py-2">热门推荐:</span>
                            <AnimatePresence mode="popLayout">
                                {recommendedTopics.length === 0 && !isTopicsLoading ? (
                                    <div className="text-xs text-slate-300 px-2">加载中...</div>
                                ) : (
                                    recommendedTopics.map(tag => (
                                    <motion.button 
                                        layout
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        key={tag}
                                        onClick={() => setTopicInput(tag)}
                                        className="px-3 py-1.5 bg-slate-100 rounded-lg text-slate-600 font-medium text-xs hover:bg-amber-100 hover:text-amber-700 transition-colors"
                                    >
                                        {tag}
                                    </motion.button>
                                    ))
                                )}
                            </AnimatePresence>
                            <button 
                                onClick={handleRefreshTopics}
                                disabled={isTopicsLoading}
                                className={`p-2 text-slate-400 hover:text-amber-500 transition-colors rounded-full hover:bg-slate-100 ml-1 duration-500 ${isTopicsLoading ? 'animate-spin' : ''}`} 
                                title="换一批"
                            >
                                <RefreshCw size={14} />
                            </button>
                        </div>
                    </div>
                    
                    {/* Configuration Area */}
                    <div className="flex flex-col gap-6 pt-4 border-t border-slate-100">
                        
                        {mode === 'story' && (
                             <VoiceSelector 
                                selected={state.selectedVoice} 
                                onSelect={(v) => setState(s => ({ ...s, selectedVoice: v }))} 
                            />
                        )}
                        
                        {/* Aspect Ratio Selector (Shared) */}
                        <div className="flex flex-col gap-3">
                            <label className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                <Monitor size={16} />
                                画面比例
                            </label>
                            <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                                <button
                                    onClick={() => setState(s => ({ ...s, selectedAspectRatio: '16:9' }))}
                                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all ${
                                        state.selectedAspectRatio === '16:9' 
                                        ? 'bg-white text-indigo-600 shadow-sm' 
                                        : 'text-slate-400 hover:text-slate-600'
                                    }`}
                                >
                                    <Monitor size={18} /> 电脑 (16:9)
                                </button>
                                <button
                                    onClick={() => setState(s => ({ ...s, selectedAspectRatio: '9:16' }))}
                                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold transition-all ${
                                        state.selectedAspectRatio === '9:16' 
                                        ? 'bg-white text-indigo-600 shadow-sm' 
                                        : 'text-slate-400 hover:text-slate-600'
                                    }`}
                                >
                                    <Smartphone size={18} /> 手机 (9:16)
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    {mode === 'story' ? (
                         <Button 
                            onClick={handleGenerate} 
                            loading={state.isLoading} 
                            size="lg" 
                            className="w-full shadow-amber-200/50 hover:shadow-amber-300/50"
                        >
                            {state.isLoading ? state.loadingStep : '开始生成动画故事'} 
                            {!state.isLoading && <Sparkles size={20} />}
                        </Button>
                    ) : (
                        <div className="space-y-4">
                            <Button 
                                onClick={handleGenerateCover} 
                                loading={isCoverLoading} 
                                size="lg" 
                                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-indigo-200/50"
                            >
                                {isCoverLoading ? '正在绘制封面...' : '一键生成 4 张精美封面'} 
                                {!isCoverLoading && <ImageIcon size={20} />}
                            </Button>
                            
                            {/* Generated Cover Result Grid */}
                            <AnimatePresence>
                                {coverImages.length > 0 && (
                                    <motion.div 
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        className="grid grid-cols-2 gap-4 mt-4"
                                    >
                                        {coverImages.map((img, idx) => (
                                            <motion.div 
                                                key={idx}
                                                initial={{ opacity: 0, scale: 0.9 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                transition={{ delay: idx * 0.1 }}
                                                className="rounded-xl overflow-hidden border-2 border-indigo-100 shadow-md bg-slate-900 relative group aspect-[9/16]"
                                                style={{ aspectRatio: state.selectedAspectRatio === '16:9' ? '16/9' : '9/16' }}
                                            >
                                                <img 
                                                    src={`data:image/jpeg;base64,${img}`} 
                                                    className="w-full h-full object-cover"
                                                    alt={`Generated Cover ${idx + 1}`}
                                                />
                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                                                    <button 
                                                        onClick={() => downloadCover(img, idx)}
                                                        className="bg-white text-indigo-600 px-4 py-2 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-transform shadow-xl text-sm"
                                                    >
                                                        <Download size={16} /> 下载
                                                    </button>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}

                </div>
              </div>
            </section>
          </div>

          {/* Sidebar: Saved Stories */}
          <div className="md:col-span-5">
            <div className="bg-white/60 p-6 rounded-[2rem] h-full min-h-[400px] border border-white shadow-lg">
              <h3 className="text-xl font-bold text-slate-700 mb-6 flex items-center gap-2">
                <BookOpen className="text-indigo-500" />
                我的故事书
              </h3>
              
              <div className="space-y-4 overflow-y-auto max-h-[500px] pr-2">
                {state.savedStories.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-4">
                    <Map size={48} className="opacity-50" />
                    <p>还没有生成过故事哦<br/>快去创造第一个吧！</p>
                  </div>
                ) : (
                  state.savedStories.map(story => (
                    <div 
                      key={story.id} 
                      onClick={() => playSavedStory(story)}
                      className="group bg-white p-4 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer border border-transparent hover:border-indigo-200 relative min-h-[100px]"
                    >
                      <div className="pr-10">
                        <h4 className="font-bold text-slate-800 group-hover:text-indigo-600 transition-colors text-sm sm:text-base line-clamp-2">
                          {story.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-500 flex-shrink-0">
                              {story.aspectRatio === '9:16' ? '📱 竖屏' : '🖥️ 横屏'}
                          </span>
                          <p className="text-xs text-slate-400 truncate">
                              {new Date(story.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      
                      {/* Delete Button - Top Right */}
                      <button 
                        onClick={(e) => handleDeleteStory(story.id, e)}
                        className="absolute top-2 right-2 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all opacity-0 group-hover:opacity-100 z-10"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>

                      {/* Play Button - Bottom Right */}
                      <div className="absolute bottom-4 right-4 bg-indigo-50 p-2 rounded-full text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-colors shadow-sm">
                        <ArrowRight size={16} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}