<script lang="ts">
  import JSZip from 'jszip';
  import type { ArticleMetadata, ProcessLog } from './lib/types';
  import { onDestroy } from 'svelte';
  import { processZipContent } from './lib/converter';

  let currentFileName = '';
  let currentImageUrl: string | undefined = undefined;
  let currentMdFile = '';
  let isProcessing = false;
  let progress = 0;
  let downloadUrl: string | null = null;
  let imageProgress = 0;
  let totalProgress = 0;
  let downloadFailures: { [mdFile: string]: { url: string; filename: string; error: string; }[] } = {};
  let processLogs: ProcessLog[] = [];
  let showUploadPanel = true;
  let selectedFilter = 'all';
  let totalFiles = 0;
  let processedFiles = 0;
  let displayProgress = 0;

  function addLog(type: 'info' | 'warning' | 'error', message: string) {
    processLogs = [...processLogs, {
      timestamp: Date.now(),
      type,
      message
    }];
  }

  function handleCancel() {
    isProcessing = false;
    showUploadPanel = true;
    progress = 0;
    downloadUrl = null;
    processLogs = [];
  }

  async function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    
    processLogs = [];
    isProcessing = true;
    showUploadPanel = false;
    progress = 0;
    downloadUrl = null;
    try {
      addLog('info', 'Starting file processing...');
      const zip = new JSZip();
      const uploadedZip = await JSZip.loadAsync(input.files[0]);
      addLog('info', 'ZIP file loaded successfully');
      
      // Find metadata file that matches pattern metadata_*.json
      const metadataFile = Object.keys(uploadedZip.files)
        .find(filename => filename.match(/^metadata_.*\.json$/));
      
      if (!metadataFile || !uploadedZip.file(metadataFile)) {
        addLog('error', 'Metadata file not found');
        throw new Error('Metadata file not found');
      }
      
      const metadata: ArticleMetadata[] = JSON.parse(
        await uploadedZip.file(metadataFile)!.async('string')
      );

      const htmlFiles: { [key: string]: string } = {};
      const contentFolder = uploadedZip.folder('content');
      if (!contentFolder) throw new Error('Content folder not found');

      totalFiles = contentFolder.file(/\.html$/).length;
      processedFiles = 0;

      for (const file of contentFolder.file(/\.html$/)) {
        currentFileName = file.name;
        htmlFiles[file.name] = await file.async('string');
        progress += 50 / Object.keys(htmlFiles).length;
      }

      const { results, failures } = await processZipContent(htmlFiles, metadata, (status) => {
        currentFileName = status.currentFile;
        if (status.currentFile.endsWith('.md')) {
          currentMdFile = status.currentFile;
          processedFiles++;
        }
        if (status.currentImage) {
          currentImageUrl = status.currentImage;
        }
      });

      downloadFailures = failures;

      const outputZip = new JSZip();
      results.forEach(({ filename, content, binary }) => {
        if (binary) {
          outputZip.file(filename, content as ArrayBuffer, { binary: true });
        } else {
          outputZip.file(filename, content as string);
        }
      });

      const blob = await outputZip.generateAsync({ type: 'blob' });
      downloadUrl = URL.createObjectURL(blob);
      progress = Math.min(100, progress);
    } catch (error) {
      console.error('Error processing files:', error);
      addLog('error', `Error processing files: ${error.message}`);
      alert('Error processing files. Please check console for details.');
    } finally {
      isProcessing = false;
      addLog('info', 'Processing completed');
    }

  function handleDownload() {
    if (!downloadUrl) return;
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'converted_markdown.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function setupImageProgressListener() {
    const handler = (event: CustomEvent) => {
      imageProgress = event.detail.progress;
      currentImageUrl = event.detail.url;
      totalProgress = progress * 0.5 + imageProgress * 0.5;
    };

    window.addEventListener('imageDownloadProgress', handler as EventListener);
    return () => {
      window.removeEventListener('imageDownloadProgress', handler as EventListener);
    };
  }

  const unsubscribe = setupImageProgressListener();
  onDestroy(() => {
    unsubscribe();
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
  }); 

  $: displayProgress = Math.min(100, Math.round(totalProgress));

  function setupProcessLogListener() {
    const handler = (event: CustomEvent<ProcessLog>) => {
      processLogs = [...processLogs, event.detail];
    };

    window.addEventListener('processLog', handler as EventListener);
    return () => {
      window.removeEventListener('processLog', handler as EventListener);
    };
  }

  const unsubscribeProcessLog = setupProcessLogListener();
  onDestroy(() => { 
    unsubscribeProcessLog();
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
  });
</script>

<main>
  <header class="header">
    <div class="header-content">
      <div class="header-left">
        <h4 class="title">Omnivore Data Converter</h4>
      </div>
      <a href="https://github.com/Quorafind/Omnivore-to-MD" class="github-link" target="_blank" rel="noopener">
        GitHub
      </a>
    </div>
  </header>
  <div class={isProcessing || downloadUrl ? 'main-content processing' : 'main-content'}>
    {#if isProcessing || downloadUrl}
      <div class="operation-section">
        <div class="progress-section">
          <div class="progress-controls">
            <div class="left-controls">
              {#if !downloadUrl}
                <button class="control-button" on:click={handleCancel}>
                    <span class="button-text">Cancel</span>
                </button>
              {/if} 
               {#if downloadUrl}
                <button class="control-button" on:click={() => showUploadPanel = true}>
                    <span class="button-text">Back</span>
                </button>
              {/if}
            </div>
            {#if downloadUrl}
              <div class="right-controls">
                <button class="download-button" on:click={handleDownload}>
                  <span class="button-text">Download Converted Files</span>
                </button>
              </div>
            {/if}
          </div>
          
          <div class="progress-bar">
            <div class="progress" style="width: {Math.min(displayProgress, 100)}%"></div>
          </div>
          
          {#if currentMdFile}
            <div class="status-text">
              <div class="status-left">Processing file: {currentMdFile}</div>
              <div class="status-right">
                {processedFiles} / {totalFiles} files processed
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if showUploadPanel}
      <div class="content-panel">
        <div class="upload-section">
          <label for="zip-upload" class="upload-button" class:processing={isProcessing}>
            {#if isProcessing}
              Processing... ({Math.min(displayProgress, 100)}%)
            {:else}
              Select Omnivore Data File
            {/if}
          </label>
          <input
            id="zip-upload"
            type="file"
            accept=".zip"
            on:change={handleFileUpload}
            disabled={isProcessing}
          />
        </div>
        <div class="intro-section">
          <h2>About This Tool</h2>
          <p>This tool helps you convert Omnivore exported ZIP files into organized Markdown files. Locally in your browser.</p>
          
          <h3>Key Features:</h3>
          <ul>
            <li>Processes everything locally in your browser - no data is sent to any server</li>
            <li>Converts articles to clean Markdown format while preserving metadata</li>
            <li>Downloads and saves all article images to an "attachments" folder</li>
            <li>Updates image links in Markdown to use local paths</li>
            <li>Maintains article organization with proper file naming</li>
          </ul>

          <h3>How to Use:</h3>
          <ol>
            <li>Export your library from Omnivore as a ZIP file</li>
            <li>Click "Select Omnivore ZIP File" above to choose your export</li>
            <li>Wait for processing to complete</li>
            <li>Download the converted files</li>
          </ol>

          <p class="note">Note: Large libraries with many images may take some time to process. Please be patient and don't close the browser window during conversion.</p>
        </div>
      </div>
    {/if}

    {#if processLogs.length > 0}
      <div class="log-panel">
        <div class="filter-buttons">
            <button 
              class="filter-button {selectedFilter === 'all' ? 'active' : ''}" 
              on:click={() => selectedFilter = 'all'}
            >
              <span class="button-text">All</span>
            </button>
            <button 
              class="filter-button {selectedFilter === 'info' ? 'active' : ''}" 
              on:click={() => selectedFilter = 'info'}
            >
              <span class="button-text">Info</span>
            </button>
            <button 
              class="filter-button {selectedFilter === 'warning' ? 'active' : ''}" 
              on:click={() => selectedFilter = 'warning'}
            >
              <span class="button-text">Warning</span>
            </button>
            <button 
              class="filter-button {selectedFilter === 'error' ? 'active' : ''}" 
              on:click={() => selectedFilter = 'error'}
            >
              <span class="button-text">Error</span>
            </button>
          </div>
        <h3>Processing Log</h3>
        <div class="log-container">
          {#each processLogs.filter(log => selectedFilter === 'all' || log.type === selectedFilter) as log}
            <div class="log-entry {log.type}">
              <span class="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span class="log-message">{log.message}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  <footer class="footer">
    <div class="footer-content">
      © 2024 Boninall
    </div>
  </footer>
</main>

<style>
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    max-width: 100%;
    overflow-x: hidden;
  }

  .header {
    background-color: #f5f5f5;
    padding: 1rem 2rem;
    border-bottom: 1px solid #ddd;
  }

  .header-content {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-left {
    text-align: left;
  }

  .title {
    font-size: 1.8rem;
    margin: 0;
    color: #445566;
  }

  .description {
    margin: 0.5rem 0 0;
    color: #778899;
  }

  .github-link {
    color: #445566;
    text-decoration: none;
    padding: 0.5rem 1rem;
    border: 1px solid rgba(15, 15, 15, 0.1);
    border-radius: 4px;
    transition: all 0.2s;
    background: white;
  }

  .github-link:hover {
    background: rgba(55, 53, 47, 0.08);
  }

  .main-content {
    padding: 2rem;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    flex: 1;
  }

  .main-content.processing {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  .content-panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 100%;
    box-sizing: border-box;
  }

  .intro-section {
    font-size: 14px;
    margin-left: 4rem;
  }

  .upload-section {
    text-align: center;
  }

  .operation-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }

  .progress-controls {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .left-controls, .right-controls {
    display: flex;
    gap: 0.5rem;
  }

  .control-button {
    padding: 0.5rem 1rem;
    border: 1px solid rgba(15, 15, 15, 0.1);
    border-radius: 4px;
    background: white;
    cursor: pointer;
    transition: background 0.2s;
    font-size: 14px;
    color: rgb(55, 53, 47);
  }

  .control-button:hover {
    background: rgba(55, 53, 47, 0.08);
  }

  .button-text {
    white-space: nowrap;
  }

  .filter-buttons {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .filter-button {
    padding: 0.5rem 1rem;
    border: 1px solid rgba(15, 15, 15, 0.1);
    border-radius: 4px;
    background: white;
    cursor: pointer;
    transition: background 0.2s;
    font-size: 14px;
    color: rgb(55, 53, 47);
    flex: 1;
    min-width: 80px;
  }

  .filter-button.active {
    background: #0056b3;
    color: white;
    border-color: #0056b3;
  }

  .filter-button:hover:not(.active) {
    background: rgba(55, 53, 47, 0.08);
  }

  .upload-button {
    background: #0056b3;
    color: white;
    padding: 0.8rem 1.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
    display: inline-block;
    font-size: 16px;
    width: 80%;
    max-width: 300px;
  }

  .upload-button:hover {
    background: #003d82;
  }

  .upload-button.processing {
    background: #dc3545;
    cursor: not-allowed;
  }

  input[type="file"] {
    display: none;
  }

  .progress-section {
    background: #fff;
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid rgba(15, 15, 15, 0.1);
    width: 100%;
    box-sizing: border-box;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background: rgba(15, 15, 15, 0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 1rem;
  }

  .progress {
    height: 100%;
    background: #0056b3;
    transition: width 0.3s ease;
  }

  .status-text {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
    color: rgb(55, 53, 47);
    margin: 0.5rem 0;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .status-left {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 1rem;
    flex: 1;
    min-width: 200px;
  }

  .status-right {
    white-space: nowrap;
  }

  .url-display {
    width: 100%;
    padding: 4px 8px;
    margin: 4px 0;
    border: 1px solid rgba(15, 15, 15, 0.1);
    border-radius: 4px;
    background: rgba(242, 241, 238, 0.6);
    color: rgb(55, 53, 47);
    font-size: 14px;
    cursor: text;
  }

  .download-button {
    padding: 0.8rem 1.5rem;
    background: #0056b3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    transition: background 0.2s;
    width: 100%;
    max-width: 300px;
  }

  .download-button:hover {
    background: #003d82;
  }

  .failures-section {
    background: rgb(253, 245, 242);
    border: 1px solid rgba(15, 15, 15, 0.1);
    border-radius: 4px;
    padding: 1rem;
  }

  .failure-group {
    margin: 1rem 0;
  }

  .failure-group h4 {
    color: rgb(235, 87, 87);
    margin: 0.5rem 0;
  }

  .failure-group ul {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .failure-group li {
    margin: 0.5rem 0;
    color: rgb(55, 53, 47);
  }

  .log-panel {
    background: #fff;
    border-radius: 4px;
    padding: 1rem;
    width: 100%;
    max-width: 100%;
    border: 1px solid rgba(15, 15, 15, 0.1);
    box-sizing: border-box;
  }

  .log-container {
    height: calc(100vh - 250px);
    overflow-y: auto;
    overflow-x: hidden;
    background: rgba(242, 241, 238, 0.6);
    border: 1px solid rgba(15, 15, 15, 0.1);
    border-radius: 4px;
    padding: 1rem;
    box-sizing: border-box;
  }

  .log-entry {
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .log-entry.info {
    background: rgb(235, 245, 250);
  }

  .log-entry.warning {
    background: rgb(253, 245, 242);
  }

  .log-entry.error {
    background: rgb(253, 235, 236);
  }

  .log-time {
    color: rgba(55, 53, 47, 0.65);
    margin-right: 1rem;
    font-size: 12px;
  }

  .log-message {
    color: rgb(55, 53, 47);
  }

  .footer {
    background-color: #f5f5f5;
    padding: 1rem 2rem;
    border-top: 1px solid #ddd;
    text-align: center;
  }

  .footer-content {
    color: #445566;
    font-size: 14px;
  }

  @media (max-width: 768px) {
    .main-content {
      padding: 1rem;
    }

    .header {
      padding: 1rem;
    }

    .header-content {
      flex-direction: column;
      gap: 1rem;
      text-align: center;
    }

    .title {
      font-size: 1.5rem;
    }

    .intro-section {
      margin-left: 0;
      padding: 0 1rem;
    }

    .progress-controls {
      flex-direction: column;
      gap: 1rem;
    }

    .left-controls, .right-controls {
      width: 100%;
      justify-content: center;
    }

    .control-button, .download-button {
      width: 100%;
      max-width: none;
    }

    .filter-buttons {
      justify-content: center;
    }

    .filter-button {
      flex: 1;
      min-width: 40%;
      text-align: center;
    }

    .log-container {
      height: 300px;
    }

    .status-text {
      flex-direction: column;
      align-items: flex-start;
    }

    .status-left {
      margin-right: 0;
      min-width: 0;
    }
  }
</style>