import fs from 'fs/promises';
import path from 'path';
import { watch } from 'fs';
import { translateText, targetLanguages } from './translationHandler.js';

/**
 * Ensures all required directories exist
 */
async function ensureTranslationDirectories(videoId) {
    const baseDir = process.cwd();
    const translationsDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedText');

    // Create main translations directory
    await fs.mkdir(translationsDir, { recursive: true });

    // Create directory for each language
    for (const lang of targetLanguages) {
        const langDir = path.join(translationsDir, lang.name);
        await fs.mkdir(langDir, { recursive: true });
    }

    // Also create English directory
    await fs.mkdir(path.join(translationsDir, 'English'), { recursive: true });

    return translationsDir;
}

/**
 * Processes a single transcription file
 */
async function processTranscription(transcriptionPath, videoId) {
    try {
        console.log(`\n=== Processing transcription: ${path.basename(transcriptionPath)} ===`);
        
        // Read transcription file
        const transcriptionContent = await fs.readFile(transcriptionPath, 'utf-8');
        const transcription = JSON.parse(transcriptionContent);
        
        // Get translations
        const translationResult = await translateText(transcription.text);
        
        // Save translations for each language
        const baseDir = process.cwd();
        const translationsDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedText');
        const fragmentName = path.basename(transcriptionPath);

        // Save English translation
        const englishDir = path.join(translationsDir, 'English');
        await fs.writeFile(
            path.join(englishDir, fragmentName),
            JSON.stringify({
                original: transcription.text,
                translation: translationResult.translations.English,
                metadata: {
                    timestamp: new Date().toISOString(),
                    metrics: translationResult.metrics
                }
            }, null, 2)
        );

        // Save translations for each target language
        for (const lang of targetLanguages) {
            const langDir = path.join(translationsDir, lang.name);
            const translation = translationResult.translations[lang.name];

            if (translation) {
                await fs.writeFile(
                    path.join(langDir, fragmentName),
                    JSON.stringify({
                        original: transcription.text,
                        translation: translation,
                        metadata: {
                            timestamp: new Date().toISOString(),
                            metrics: translationResult.metrics,
                            languageCode: lang.code
                        }
                    }, null, 2)
                );
            }
        }

        console.log(`✓ Successfully processed and saved translations for: ${path.basename(transcriptionPath)}`);
        return true;
    } catch (error) {
        console.error(`❌ Error processing transcription ${path.basename(transcriptionPath)}:`, error);
        return false;
    }
}

/**
 * Gets existing translations to avoid reprocessing
 */
async function getExistingTranslations(translationsDir) {
    try {
        const existingTranslations = new Set();
        const englishDir = path.join(translationsDir, 'English');
        
        try {
            const files = await fs.readdir(englishDir);
            files.forEach(file => existingTranslations.add(file));
        } catch (error) {
            // English directory might not exist yet
        }

        return existingTranslations;
    } catch (error) {
        console.error('Error getting existing translations:', error);
        return new Set();
    }
}

/**
 * Sets up translation watcher for a video
 */
async function setupTranslationWatcher(videoId) {
    try {
        console.log('\n=== Setting up Translation Process ===');
        console.log('Video ID:', videoId);

        const baseDir = process.cwd();
        const transcriptionsDir = path.join(baseDir, 'temp_files', videoId, 'ExtractedText');
        
        // Ensure translation directories exist
        const translationsDir = await ensureTranslationDirectories(videoId);
        console.log('✓ Translation directories created');

        // Get existing translations
        const existingTranslations = await getExistingTranslations(translationsDir);
        console.log(`Found ${existingTranslations.size} existing translations`);

        // Process existing transcriptions
        try {
            const files = await fs.readdir(transcriptionsDir);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            console.log(`Found ${jsonFiles.length} transcriptions to process`);

            // Sort files by fragment number
            const sortedFiles = jsonFiles.sort((a, b) => {
                const numA = parseInt(a.match(/fragment-(\d+)\.json$/)?.[1] || '0');
                const numB = parseInt(b.match(/fragment-(\d+)\.json$/)?.[1] || '0');
                return numA - numB;
            });

            // Process each file
            for (const file of sortedFiles) {
                if (!existingTranslations.has(file)) {
                    const transcriptionPath = path.join(transcriptionsDir, file);
                    await processTranscription(transcriptionPath, videoId);
                } else {
                    console.log(`Skipping existing translation: ${file}`);
                }
            }
        } catch (error) {
            console.error('Error processing existing transcriptions:', error);
        }

        // Watch for new transcriptions
        console.log('\n=== Setting up Transcription Watcher ===');
        const watcher = watch(transcriptionsDir, { persistent: true });

        watcher.on('change', async (eventType, filename) => {
            if (filename && filename.endsWith('.json')) {
                // Wait a bit to ensure file is completely written
                setTimeout(async () => {
                    if (!existingTranslations.has(filename)) {
                        const transcriptionPath = path.join(transcriptionsDir, filename);
                        if (await processTranscription(transcriptionPath, videoId)) {
                            existingTranslations.add(filename);
                        }
                    }
                }, 1000);
            }
        });

        console.log('✓ Translation watcher setup complete');
        return watcher;
    } catch (error) {
        console.error('Error setting up translation watcher:', error);
        throw error;
    }
}

/**
 * Gets translation status for a video
 */
async function getTranslationStatus(videoId) {
    try {
        const baseDir = process.cwd();
        const transcriptionsDir = path.join(baseDir, 'temp_files', videoId, 'ExtractedText');
        const translationsDir = path.join(baseDir, 'temp_files', videoId, 'FinalTranslatedText');

        // Count transcription files
        const transcriptionFiles = await fs.readdir(transcriptionsDir)
            .then(files => files.filter(f => f.endsWith('.json')))
            .catch(() => []);

        // Count translation files (using English as reference)
        const englishDir = path.join(translationsDir, 'English');
        const translatedFiles = await fs.readdir(englishDir)
            .then(files => files.filter(f => f.endsWith('.json')))
            .catch(() => []);

        // Get status for each language
        const languageStatus = {};
        for (const lang of [...targetLanguages, { name: 'English' }]) {
            const langDir = path.join(translationsDir, lang.name);
            const langFiles = await fs.readdir(langDir)
                .then(files => files.filter(f => f.endsWith('.json')))
                .catch(() => []);
            
            languageStatus[lang.name] = {
                filesCount: langFiles.length,
                progress: transcriptionFiles.length ? (langFiles.length / transcriptionFiles.length) * 100 : 0
            };
        }

        return {
            totalTranscriptions: transcriptionFiles.length,
            translatedFiles: translatedFiles.length,
            overallProgress: transcriptionFiles.length ? (translatedFiles.length / transcriptionFiles.length) * 100 : 0,
            languageStatus,
            isComplete: transcriptionFiles.length > 0 && translatedFiles.length === transcriptionFiles.length
        };
    } catch (error) {
        return {
            totalTranscriptions: 0,
            translatedFiles: 0,
            overallProgress: 0,
            languageStatus: {},
            isComplete: false,
            error: error.message
        };
    }
}

export { setupTranslationWatcher, getTranslationStatus }; 