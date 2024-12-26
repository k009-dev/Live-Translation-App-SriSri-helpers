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
        const languages = ['Hindi', 'Sanskrit', 'Kannada'];
        for (const lang of languages) {
            const langDir = path.join(audioDir, lang);
            console.log('Creating language directory:', langDir);
            await fs.mkdir(langDir, { recursive: true });
            console.log('✓ Created directory for', lang);
        }

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
        const languages = ['Hindi', 'Sanskrit', 'Kannada'];
        const languageStatus = {};
        
        for (const lang of languages) {
            const langDir = path.join(audioDir, lang);
            const audioFiles = await fs.readdir(langDir)
                .then(files => files.filter(f => f.endsWith('.wav')))
                .catch(() => []);
            
            languageStatus[lang] = {
                filesCount: audioFiles.length,
                progress: translationFiles.length ? (audioFiles.length / translationFiles.length) * 100 : 0
            };
        }

        return {
            totalTranslations: translationFiles.length,
            processedAudioFiles: Object.values(languageStatus)[0]?.filesCount || 0,
            overallProgress: translationFiles.length ? 
                (Object.values(languageStatus)[0]?.filesCount || 0) / translationFiles.length * 100 : 0,
            languageStatus,
            isComplete: translationFiles.length > 0 && 
                Object.values(languageStatus).every(s => s.filesCount === translationFiles.length)
        };
    } catch (error) {
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