import fs from 'fs/promises';
import path from 'path';
import { generateAudio, processLanguagesInPairs, saveAudioFile } from './audioHandler.js';

class AudioSyncManager {
    constructor(videoId) {
        this.videoId = videoId;
        this.baseDir = process.cwd();
        this.audioDir = path.join(this.baseDir, 'temp_files', videoId, 'FinalTranslatedAudio');
        this.translationsDir = path.join(this.baseDir, 'temp_files', videoId, 'FinalTranslatedText');
        this.currentFragment = 0;
        this.isProcessing = false;
        this.languages = [
            'English', 'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada',
            'Marathi', 'Gujarati', 'Punjabi', 'Sanskrit', 'French', 'Spanish', 'Russian'
        ];
    }

    /**
     * Check if all languages have processed a specific fragment
     */
    async isFragmentComplete(fragmentNum) {
        try {
            for (const lang of this.languages) {
                const audioPath = path.join(this.audioDir, lang, `fragment-${fragmentNum}.wav`);
                try {
                    await fs.access(audioPath);
                } catch {
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error(`Error checking fragment ${fragmentNum}:`, error);
            return false;
        }
    }

    /**
     * Get the next fragment that needs processing
     */
    async findNextFragment() {
        let fragment = this.currentFragment;
        while (await this.isFragmentComplete(fragment)) {
            fragment++;
        }
        return fragment;
    }

    /**
     * Check if translations exist for a fragment
     */
    async hasTranslations(fragmentNum) {
        try {
            for (const lang of this.languages) {
                const translationPath = path.join(
                    this.translationsDir, 
                    lang, 
                    `fragment-${fragmentNum}.json`
                );
                try {
                    await fs.access(translationPath);
                } catch {
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error(`Error checking translations for fragment ${fragmentNum}:`, error);
            return false;
        }
    }

    /**
     * Process a specific fragment for all languages
     */
    async processFragment(fragmentNum) {
        console.log(`\n=== Processing fragment ${fragmentNum} for all languages ===`);
        
        // Read all translations first
        const translations = {};
        let allTranslationsRead = true;
        
        for (const lang of this.languages) {
            try {
                const translationPath = path.join(
                    this.translationsDir,
                    lang,
                    `fragment-${fragmentNum}.json`
                );
                const content = await fs.readFile(translationPath, 'utf-8');
                const data = JSON.parse(content);
                translations[lang] = data.translation.text;
                console.log(`✓ Read translation for ${lang} fragment ${fragmentNum}`);
            } catch (error) {
                console.error(`Error reading translation for ${lang}:`, error);
                allTranslationsRead = false;
                break;
            }
        }

        if (!allTranslationsRead) {
            console.error(`Failed to read all translations for fragment ${fragmentNum}`);
            return false;
        }

        // Process languages until all are complete for this fragment
        while (true) {
            // Check which languages still need processing
            const remainingLanguages = [];
            for (const lang of this.languages) {
                const audioPath = path.join(this.audioDir, lang, `fragment-${fragmentNum}.wav`);
                try {
                    await fs.access(audioPath);
                    console.log(`✓ Already have audio for ${lang} fragment ${fragmentNum}`);
                } catch {
                    remainingLanguages.push(lang);
                }
            }

            // If all languages are done, we're finished with this fragment
            if (remainingLanguages.length === 0) {
                console.log(`✓ All languages completed for fragment ${fragmentNum}`);
                return true;
            }

            console.log(`\nRemaining languages for fragment ${fragmentNum}:`, remainingLanguages);

            // Process remaining languages in pairs or single
            if (remainingLanguages.length === 1) {
                // Process single remaining language
                const lang = remainingLanguages[0];
                console.log(`\nProcessing final language: ${lang}`);
                
                let success = false;
                let retryCount = 0;
                const maxRetries = 3;

                while (!success && retryCount < maxRetries) {
                    try {
                        const results = await processLanguagesInPairs(translations, [lang]);
                        const audioData = results[`${lang}_audio`];
                        
                        if (audioData) {
                            const outputPath = path.join(
                                this.audioDir,
                                lang,
                                `fragment-${fragmentNum}.wav`
                            );
                            success = await saveAudioFile(audioData, outputPath);
                            if (success) {
                                console.log(`✓ Saved audio for ${lang} fragment ${fragmentNum}`);
                                break;
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing ${lang} (attempt ${retryCount + 1}):`, error);
                    }

                    retryCount++;
                    if (retryCount < maxRetries) {
                        console.log(`Retrying ${lang} in 5 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }

                if (!success) {
                    console.error(`Failed to process ${lang} after ${maxRetries} attempts`);
                    return false;
                }
            } else {
                // Process first pair
                const pair = [remainingLanguages[0], remainingLanguages[1]];
                console.log(`\nProcessing pair: ${pair.join(', ')}`);
                
                let success = false;
                let retryCount = 0;
                const maxRetries = 3;

                while (!success && retryCount < maxRetries) {
                    try {
                        const results = await processLanguagesInPairs(translations, pair);
                        let pairSuccess = true;

                        // Save results
                        for (const lang of pair) {
                            const audioData = results[`${lang}_audio`];
                            if (audioData) {
                                const outputPath = path.join(
                                    this.audioDir,
                                    lang,
                                    `fragment-${fragmentNum}.wav`
                                );
                                const saved = await saveAudioFile(audioData, outputPath);
                                if (!saved) {
                                    pairSuccess = false;
                                    break;
                                }
                                console.log(`✓ Saved audio for ${lang} fragment ${fragmentNum}`);
                            } else {
                                pairSuccess = false;
                                break;
                            }
                        }

                        if (pairSuccess) {
                            success = true;
                            break;
                        }
                    } catch (error) {
                        console.error(`Error processing pair ${pair.join(', ')} (attempt ${retryCount + 1}):`, error);
                    }

                    retryCount++;
                    if (retryCount < maxRetries) {
                        console.log(`Retrying pair ${pair.join(', ')} in 5 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }

                if (!success) {
                    console.error(`Failed to process pair ${pair.join(', ')} after ${maxRetries} attempts`);
                    return false;
                }
            }

            // Small delay before checking remaining languages again
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    /**
     * Start the synchronization process
     */
    async start() {
        if (this.isProcessing) {
            console.log('Already processing...');
            return;
        }

        this.isProcessing = true;
        console.log('\n=== Starting Audio Sync Manager ===');

        try {
            while (true) {
                const nextFragment = await this.findNextFragment();
                
                // Check if translations exist for this fragment
                if (await this.hasTranslations(nextFragment)) {
                    console.log(`\nProcessing fragment ${nextFragment}`);
                    const success = await this.processFragment(nextFragment);
                    
                    if (success) {
                        // Double check all languages are complete
                        let allComplete = true;
                        for (const lang of this.languages) {
                            const audioPath = path.join(this.audioDir, lang, `fragment-${nextFragment}.wav`);
                            try {
                                await fs.access(audioPath);
                            } catch {
                                allComplete = false;
                                break;
                            }
                        }

                        if (allComplete) {
                            console.log(`✓ Verified fragment ${nextFragment} complete for all languages`);
                            this.currentFragment = nextFragment + 1;
                        } else {
                            console.error(`Fragment ${nextFragment} verification failed, retrying`);
                            // Wait before retrying
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    } else {
                        console.error(`Failed to process fragment ${nextFragment}`);
                        // Wait before retrying the same fragment
                        console.log(`Retrying fragment ${nextFragment} in 5 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                } else {
                    // No more translations available, wait for more
                    console.log(`Waiting for translations for fragment ${nextFragment}...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } catch (error) {
            console.error('Error in sync manager:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get current progress
     */
    async getProgress() {
        const progress = {
            currentFragment: this.currentFragment,
            languageProgress: {}
        };

        for (const lang of this.languages) {
            try {
                const langDir = path.join(this.audioDir, lang);
                const files = await fs.readdir(langDir);
                progress.languageProgress[lang] = files.length;
            } catch (error) {
                progress.languageProgress[lang] = 0;
            }
        }

        return progress;
    }
}

export default AudioSyncManager; 