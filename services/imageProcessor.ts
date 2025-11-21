
import { AspectRatio } from '../types';

/**
 * Adds the story title to the cover image using HTML Canvas.
 * @param base64Image The raw generated image
 * @param title The text to overlay
 * @param ratio The aspect ratio
 * @returns Promise resolving to the new base64 image string (without prefix)
 */
export const addTitleToCover = async (base64Image: string, title: string, ratio: AspectRatio): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Use a high resolution for sharpness
            const width = ratio === '9:16' ? 1080 : 1920;
            const height = ratio === '9:16' ? 1920 : 1080;
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(base64Image);
                return;
            }

            // 1. Draw Image
            // Cover style fitting
            const imgRatio = img.width / img.height;
            const canvasRatio = width / height;
            let drawW, drawH, offsetX, offsetY;

            if (imgRatio > canvasRatio) {
                drawH = height;
                drawW = height * imgRatio;
                offsetY = 0;
                offsetX = (width - drawW) / 2;
            } else {
                drawW = width;
                drawH = width / imgRatio;
                offsetX = 0;
                offsetY = (height - drawH) / 2;
            }

            ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

            // 2. Add Gradient Background for Text (Bottom fade)
            // Make it slightly subtler
            const gradientHeight = height * 0.35;
            const gradient = ctx.createLinearGradient(0, height - gradientHeight, 0, height);
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(0.5, 'rgba(0,0,0,0.4)');
            gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(0, height - gradientHeight, width, gradientHeight);

            // 3. Draw Text
            // Use the app's font: Zcool KuaiLe
            const fontSize = ratio === '9:16' ? 110 : 130;
            ctx.font = `900 ${fontSize}px "Zcool KuaiLe", "Nunito", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            
            // Text Shadow/Outline - Clean style
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 15;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 4;
            
            // Draw Main Text
            const bottomMargin = ratio === '9:16' ? 180 : 100;
            
            // Simple Word Wrap for long titles
            const maxWidth = width * 0.85;
            const words = title.split('');
            let line = '';
            const lines = [];
            
            for (let i = 0; i < words.length; i++) {
                const testLine = line + words[i];
                const metrics = ctx.measureText(testLine);
                if (metrics.width > maxWidth && i > 0) {
                    lines.push(line);
                    line = words[i];
                } else {
                    line = testLine;
                }
            }
            lines.push(line);

            // Draw lines
            const lineHeight = fontSize * 1.2;
            const totalHeight = lines.length * lineHeight;
            let y = height - bottomMargin - ((lines.length - 1) * lineHeight);

            // Color: Gold/Yellow gradient fill for text
            const textGradient = ctx.createLinearGradient(0, y - totalHeight, 0, y + lineHeight);
            textGradient.addColorStop(0, '#FFFBEB'); // Light yellow
            textGradient.addColorStop(0.5, '#FCD34D'); // Amber 300
            textGradient.addColorStop(1, '#F59E0B'); // Amber 500

            lines.forEach((l) => {
                // Stroke - Darker brown for pop
                ctx.strokeStyle = '#451a03'; 
                ctx.lineWidth = fontSize * 0.05;
                ctx.lineJoin = 'round';
                ctx.miterLimit = 2;

                ctx.strokeText(l, width / 2, y);
                
                // Fill
                ctx.fillStyle = textGradient;
                ctx.fillText(l, width / 2, y);
                y += lineHeight;
            });

            // 4. Export
            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            // Remove prefix for consistency with app state
            const cleanB64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
            resolve(cleanB64);
        };
        
        img.onerror = (e) => reject(e);
        img.src = `data:image/jpeg;base64,${base64Image}`;
    });
};