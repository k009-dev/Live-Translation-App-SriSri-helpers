import fs from 'fs/promises';
import path from 'path';
import AudioSyncManager from './audioSyncManager.js';

/**
 * Ensures audio directories exist
 */
async function ensureAudioDirectories(videoId) {
    try {
        const baseDir = process.cwd();
        const audioDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedAudio');
        
        console.log('Creating audio directory:', audioDir);

        // Create main audio directory
        await fs.mkdir(audioDir, { recursive: true });
        console.log('✓ Created main audio directory');

        // Create directory for each language
        const languages = ['Hindi', 'Sanskrit', 'Marathi'];
        for (const lang of languages) {
            const langDir = path.join(audioDir, lang);
            console.log('Creating language directory:', langDir);
            await fs.mkdir(langDir, { recursive: true });
            console.log('✓ Created directory for', lang);
        }

        // Also ensure the ExtractedAudio directories exist
        const extractedAudioDir = path.join(baseDir, 'temp_files', videoId, 'ExtractedAudio');
        const finalExtractedDir = path.join(extractedAudioDir, 'FinalExtracted');
        const preprocessingDir = path.join(extractedAudioDir, 'PreProcessing');

        await fs.mkdir(finalExtractedDir, { recursive: true });
        await fs.mkdir(preprocessingDir, { recursive: true });
        console.log('✓ Created ExtractedAudio directories');

        return audioDir;
    } catch (error) {
        console.error('Error creating audio directories:', error);
        throw error;
    }
}

/**
 * Gets audio generation status
 */
async function getAudioStatus(videoId) {
    try {
        const baseDir = process.cwd();
        const translationsDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedText', 'Hindi');
        const audioDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedAudio');

        // Count translation files
        const translationFiles = await fs.readdir(translationsDir)
            .then(files => files.filter(f => f.endsWith('.json')))
            .catch(() => []);

        // Get status for each language
        const languages = ['Hindi', 'Sanskrit', 'Marathi'];
        const languageStatus = {};
        
        for (const lang of languages) {
            const langDir = path.join(audioDir, lang);
            console.log(`📂 Checking audio files for ${lang} in ${langDir}`);
            
            try {
                const files = await fs.readdir(langDir);
                console.log(`📁 Found files in ${lang} directory:`, files);
                
                // Get both WAV and MP3 files
                const wavFiles = files.filter(f => f.endsWith('.wav'));
                const mp3Files = files.filter(f => f.endsWith('.mp3'));
                
                console.log(`📊 ${lang} status:`, {
                    wavFiles,
                    mp3Files,
                    totalWav: wavFiles.length,
                    totalMp3: mp3Files.length
                });

                // Sort files by fragment number
                const sortedMp3Files = mp3Files.sort((a, b) => {
                    const numA = parseInt(a.match(/fragment-(\d+)\.mp3/)?.[1] || '0');
                    const numB = parseInt(b.match(/fragment-(\d+)\.mp3/)?.[1] || '0');
                    return numA - numB;
                });
                
                languageStatus[lang] = {
                    filesCount: mp3Files.length,
                    progress: translationFiles.length ? (mp3Files.length / translationFiles.length) * 100 : 0,
                    files: sortedMp3Files,
                    wavFiles: wavFiles,
                    mp3Files: mp3Files
                };
            } catch (error) {
                console.error(`❌ Error reading directory for ${lang}:`, error);
                languageStatus[lang] = {
                    filesCount: 0,
                    progress: 0,
                    files: [],
                    wavFiles: [],
                    mp3Files: [],
                    error: error.message
                };
            }
        }

        const status = {
            totalTranslations: translationFiles.length,
            processedAudioFiles: Object.values(languageStatus)[0]?.filesCount || 0,
            overallProgress: translationFiles.length ? 
                (Object.values(languageStatus)[0]?.filesCount || 0) / translationFiles.length * 100 : 0,
            languageStatus,
            isComplete: translationFiles.length > 0 && 
                Object.values(languageStatus).every(s => s.filesCount === translationFiles.length)
        };

        console.log('📊 Overall audio status:', status);
        return status;
    } catch (error) {
        console.error('❌ Error getting audio status:', error);
        return {
            totalTranslations: 0,
            processedAudioFiles: 0,
            overallProgress: 0,
            languageStatus: {},
            isComplete: false,
            error: error.message
        };
    }
}

/**
 * Sets up audio generation watcher
 */
async function setupAudioWatcher(videoId) {
    try {
        console.log('\n=== Setting up Audio Generation Process ===');
        
        // Ensure directories exist
        await ensureAudioDirectories(videoId);
        
        // Create and start the sync manager
        const syncManager = new AudioSyncManager(videoId);
        await syncManager.start();
        
        return true;
    } catch (error) {
        console.error('Error setting up audio watcher:', error);
        throw error;
    }
}

export { setupAudioWatcher, getAudioStatus }; 