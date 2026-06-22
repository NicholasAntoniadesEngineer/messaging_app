/**
 * File Service
 * Handles all file I/O operations
 * @module services/FileService
 */

const FileService = {
    MONTHS_DIR: '/data/months/',

    /**
     * Load a month from individual JSON file
     * @param {string} monthKey - Month key (e.g., "2025-11")
     * @returns {Promise<Object|null>} Month data or null if not found
     */
    async loadMonthFromFile(monthKey) {
        try {
            if (window.location.protocol === 'file:') {
                return null;
            }
            
            const response = await fetch(`${this.MONTHS_DIR}${monthKey}.json`);
            if (!response.ok) {
                return null;
            }
            const monthData = await response.json();
            console.log(`✓ Loaded ${monthKey}.json from files`);
            return monthData;
        } catch (error) {
            return null;
        }
    },

    /**
     * Load all months from individual JSON files
     * @returns {Promise<Object>} Object with all months keyed by monthKey
     */
    async loadAllMonthsFromFiles() {
        if (window.location.protocol === 'file:') {
            return {};
        }
        
        const allMonths = {};
        const currentYear = new Date().getFullYear();
        const years = [currentYear - 1, currentYear, currentYear + 1];
        let loadedCount = 0;

        for (const year of years) {
            for (let month = 1; month <= 12; month++) {
                const monthKey = `${year}-${String(month).padStart(2, '0')}`;
                try {
                    const monthData = await this.loadMonthFromFile(monthKey);
                    if (monthData) {
                        allMonths[monthKey] = monthData;
                        loadedCount++;
                    }
                } catch (error) {
                    // File doesn't exist, skip
                }
            }
        }

        if (loadedCount > 0) {
            console.log(`✓ Loaded ${loadedCount} months from files`);
        }

        return allMonths;
    },

    /**
     * Load months from file picker (File System Access API)
     * @returns {Promise<Object>} Result object with success, count, months, etc.
     */
    async loadMonthsFromFilePicker() {
        try {
            const isFileProtocol = window.location.protocol === 'file:';
            
            if ('showDirectoryPicker' in window && !isFileProtocol) {
                try {
                    const directoryHandle = await window.showDirectoryPicker();
                    const months = {};
                    let loadedCount = 0;
                    const htmlFiles = [];
                    const csvFiles = [];
                    
                    for await (const entry of directoryHandle.values()) {
                        if (entry.kind === 'file') {
                            if (entry.name.endsWith('.json')) {
                                try {
                                    const file = await entry.getFile();
                                    const content = await file.text();
                                    const monthData = JSON.parse(content);
                                    const monthKey = entry.name.replace('.json', '');
                                    months[monthKey] = monthData;
                                    loadedCount++;
                                    console.log(`✓ Loaded ${monthKey}.json`);
                                } catch (error) {
                                    console.error(`Error loading ${entry.name}:`, error);
                                }
                            } else if (entry.name.endsWith('.csv')) {
                                csvFiles.push(entry);
                            } else if (entry.name.endsWith('.html')) {
                                htmlFiles.push(entry);
                            }
                        }
                    }
                    
                    if (csvFiles.length > 0 && window.CSVHandler) {
                        for (const entry of csvFiles) {
                            try {
                                const file = await entry.getFile();
                                const csvText = await file.text();
                                const fileName = entry.name.toLowerCase();
                                const monthData = this.parseMonthFromFileName(fileName, csvText, 'csv');
                                if (monthData) {
                                    const monthKey = monthData.key;
                                    months[monthKey] = monthData;
                                    loadedCount++;
                                    console.log(`✓ Imported ${monthKey} from ${entry.name}`);
                                }
                            } catch (error) {
                                console.error(`Error importing CSV ${entry.name}:`, error);
                            }
                        }
                    }
                    
                    if (htmlFiles.length > 0 && window.ReferenceImporter) {
                        for (const entry of htmlFiles) {
                            try {
                                const file = await entry.getFile();
                                const fileName = entry.name.toLowerCase();
                                const monthInfo = this.extractMonthInfoFromFileName(fileName);
                                if (monthInfo) {
                                    const monthData = await window.ReferenceImporter.importMonthFromFile(file, monthInfo.monthName, monthInfo.year);
                                    if (monthData && monthData.key) {
                                        months[monthData.key] = monthData;
                                        loadedCount++;
                                        console.log(`✓ Imported ${monthData.key} from ${entry.name}`);
                                    }
                                }
                            } catch (error) {
                                console.error(`Error importing ${entry.name}:`, error);
                            }
                        }
                    }
                    
                    if (loadedCount > 0) {
                        return { success: true, count: loadedCount, months: months };
                    } else {
                        return { success: false, message: 'No valid month files found in directory' };
                    }
                } catch (error) {
                    if (error.name !== 'AbortError') {
                        console.warn('Directory picker failed:', error);
                        return { success: false, message: error.message, useFileInput: true };
                    } else {
                        return { success: false, message: 'User cancelled' };
                    }
                }
            }
            
            return { success: false, message: 'File System Access API not available. Please use the file input button.', useFileInput: true };
        } catch (error) {
            console.error('Error loading months from files:', error);
            return { success: false, message: error.message, useFileInput: true };
        }
    },

    /**
     * Load months from file input (multiple files)
     * @param {FileList} files - File list from input element
     * @returns {Promise<Object>} Result object with success, count, errors, months
     */
    async loadMonthsFromFileInput(files) {
        const months = {};
        let loadedCount = 0;
        let errorCount = 0;
        const htmlFiles = [];
        const csvFiles = [];
        
        for (const file of files) {
            if (file.name.endsWith('.json')) {
                try {
                    const content = await file.text();
                    const monthData = JSON.parse(content);
                    const monthKey = file.name.replace('.json', '');
                    months[monthKey] = monthData;
                    loadedCount++;
                    console.log(`✓ Loaded ${monthKey}.json`);
                } catch (error) {
                    console.error(`Error loading ${file.name}:`, error);
                    errorCount++;
                }
            } else if (file.name.endsWith('.csv')) {
                csvFiles.push(file);
            } else if (file.name.endsWith('.html')) {
                htmlFiles.push(file);
            }
        }
        
        if (csvFiles.length > 0) {
            if (!window.CSVHandler) {
                console.error('CSVHandler not available. Cannot import CSV files.');
                errorCount += csvFiles.length;
            } else {
                for (const file of csvFiles) {
                    try {
                        const csvText = await file.text();
                        const fileName = file.name.toLowerCase();
                        const monthData = this.parseMonthFromFileName(fileName, csvText, 'csv');
                        if (monthData && monthData.key) {
                            months[monthData.key] = monthData;
                            loadedCount++;
                            console.log(`✓ Imported ${monthData.key} from ${file.name}`);
                        } else {
                            errorCount++;
                        }
                    } catch (error) {
                        console.error(`Error importing CSV ${file.name}:`, error);
                        errorCount++;
                    }
                }
            }
        }
        
        if (htmlFiles.length > 0) {
            if (!window.ReferenceImporter) {
                console.error('ReferenceImporter not available. Cannot import HTML files.');
                errorCount += htmlFiles.length;
            } else {
                for (const file of htmlFiles) {
                    try {
                        const fileName = file.name.toLowerCase();
                        const monthInfo = this.extractMonthInfoFromFileName(fileName);
                        if (monthInfo) {
                            const monthData = await window.ReferenceImporter.importMonthFromFile(file, monthInfo.monthName, monthInfo.year);
                            if (monthData && monthData.key) {
                                months[monthData.key] = monthData;
                                loadedCount++;
                                console.log(`✓ Imported ${monthData.key} from ${file.name}`);
                            } else {
                                errorCount++;
                            }
                        } else {
                            errorCount++;
                        }
                    } catch (error) {
                        console.error(`Error importing ${file.name}:`, error);
                        errorCount++;
                    }
                }
            }
        }
        
        return { success: loadedCount > 0, count: loadedCount, errors: errorCount, months: months };
    },

    /**
     * Extract month name and year from filename
     * @param {string} fileName - Filename (lowercase)
     * @returns {Object|null} Object with monthName and year, or null
     */
    extractMonthInfoFromFileName(fileName) {
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                          'july', 'august', 'september', 'october', 'november', 'december'];
        
        let monthName = null;
        let year = new Date().getFullYear();
        
        for (const month of monthNames) {
            if (fileName.includes(month)) {
                monthName = month.charAt(0).toUpperCase() + month.slice(1);
                break;
            }
        }
        
        const yearMatch = fileName.match(/\b(20\d{2})\b/);
        if (yearMatch) {
            year = parseInt(yearMatch[1], 10);
        }
        
        if (!monthName) {
            const nameMatch = fileName.match(/^([a-z]+)-(\d{4})\./i);
            if (nameMatch) {
                monthName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).toLowerCase();
                year = parseInt(nameMatch[2], 10);
            } else {
                return null;
            }
        }
        
        return { monthName, year };
    },

    /**
     * Parse month data from filename and content
     * @param {string} fileName - Filename (lowercase)
     * @param {string} content - File content
     * @param {string} format - File format ('csv' or 'html')
     * @returns {Object|null} Month data or null
     */
    parseMonthFromFileName(fileName, content, format) {
        const monthInfo = this.extractMonthInfoFromFileName(fileName);
        if (!monthInfo) {
            return null;
        }

        if (format === 'csv' && window.CSVHandler) {
            return window.CSVHandler.csvToMonthData(content, monthInfo.monthName, monthInfo.year);
        }

        return null;
    }
};

if (typeof window !== 'undefined') {
    window.FileService = FileService;
}
