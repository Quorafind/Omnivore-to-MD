import { createMarkdownContent } from "./markdown-converter";
import type { ArticleMetadata, ConversionResult, ProcessLog } from "./types";

// Add timeout control to fetch function
async function fetchWithTimeout(url: string, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Add event emission function
function emitProcessLog(type: 'info' | 'warning' | 'error', message: string) {
  window.dispatchEvent(
    new CustomEvent("processLog", {
      detail: {
        timestamp: Date.now(),
        type,
        message,
      } as ProcessLog,
    })
  );
}

// Update image download function
async function downloadImage(url: string): Promise<ArrayBuffer | null> {
  // Try downloading from proxy URL
  if (url.includes("proxy-prod.omnivore-image-cache.app")) {
    try {
      const response = await fetchWithTimeout(url);
      if (response.ok) {
        emitProcessLog('info', `Successfully downloaded image from proxy: ${url}`);
        return await response.arrayBuffer();
      }
    } catch (error) {
      emitProcessLog('warning', `Failed to download from proxy URL: ${url}`);
      console.warn("Failed to download from proxy URL:", error);
    }

    // Extract original URL
    const matches = url.match(
      /https:\/\/proxy-prod\.omnivore-image-cache\.app\/.*?\/(https?.*)/
    );
    if (matches && matches[1]) {
      const originalUrl = decodeURIComponent(matches[1]);
      try {
        const response = await fetchWithTimeout(originalUrl);
        if (response.ok) {
          emitProcessLog('info', `Successfully downloaded image from original URL: ${originalUrl}`);
          return await response.arrayBuffer();
        }
      } catch (error) {
        emitProcessLog('warning', `Failed to download from original URL: ${originalUrl}`);
        console.warn("Failed to download from original URL:", error);
      }
    }
  }

  // Try direct URL download
  try {
    const response = await fetchWithTimeout(url);
    if (response.ok) {
      emitProcessLog('info', `Successfully downloaded image: ${url}`);
      return await response.arrayBuffer();
    }
  } catch (error) {
    emitProcessLog('error', `Failed to download image: ${url}`);
    console.warn(`Failed to download image: ${url}`, error);
  }

  return null;
}

// Add new type definition
type ProgressCallback = (status: {
  currentFile: string;
  currentImage?: string;
}) => void;

// Add new type definition at file top
type DownloadFailure = {
  url: string;
  filename: string;
  error: string;
};

// Update image processing function
async function processMarkdownImages(
  markdown: string,
  mdFilename: string,
  metadata?: ArticleMetadata,
  progressCallback?: ProgressCallback
): Promise<{
  markdown: string;
  images: { [filename: string]: ArrayBuffer };
  failures: DownloadFailure[];
}> {
  const images: { [filename: string]: ArrayBuffer } = {};
  const failures: DownloadFailure[] = [];
  const imageRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  let newMarkdown = markdown;
  const imagePromises: Promise<void>[] = [];

  const matches = [...markdown.matchAll(imageRegex)];
  const total = matches.length + (metadata?.thumbnail ? 1 : 0);
  let completed = 0;
  let imageCounter = 1;

  // Extract base name from filename (without extension)
  const baseFilename = mdFilename.replace(/\.md$/, '');
  // Process thumbnail from metadata if exists
  if (metadata?.thumbnail) {
    const thumbnailUrl = metadata.thumbnail;
    
    // Get file extension from URL or default to png
    const validImageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
    let extension = 'png';
    
    const urlParts = thumbnailUrl.split('.');
    if (urlParts.length > 1) {
      const urlExt = urlParts.pop()!.toLowerCase().split(/[#?]/)[0];
      if (validImageExtensions.includes(urlExt)) {
        extension = urlExt;
      }
    }

    const filename = `${baseFilename}-thumbnail.${extension}`;

    progressCallback?.({
      currentFile: 'Processing thumbnail',
      currentImage: thumbnailUrl
    });

    const downloadPromise = downloadImage(thumbnailUrl)
      .then((buffer) => {
        if (buffer) {
          images[filename] = buffer;
          // Update thumbnail path in metadata
          metadata.thumbnail = `./attachments/${filename}`;
        } else {
          failures.push({
            url: thumbnailUrl,
            filename: filename,
            error: 'Download failed'
          });
          console.warn(`Keeping original URL for failed thumbnail download: ${thumbnailUrl}`);
        }
        completed++;
        const progress = (completed / total) * 100;
        window.dispatchEvent(
          new CustomEvent("imageDownloadProgress", {
            detail: { 
              progress,
              url: thumbnailUrl 
            },
          })
        );
      })
      .catch((error) => {
        failures.push({
          url: thumbnailUrl,
          filename: filename,
          error: error.message
        });
        console.warn(`Failed to process thumbnail ${thumbnailUrl}:`, error);
        completed++;
      });

    imagePromises.push(downloadPromise);
  }

  for (const match of matches) {
    let imageUrl = match[1];
    // Remove query parameters from URL
    imageUrl = imageUrl.split('?')[0];
    
    // Generate a clean filename without special characters
    const cleanBasename = baseFilename.replace(/[^a-zA-Z0-9-]/g, '');
    
    // Get file extension from URL or default to png
    const validImageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
    let extension = 'png';
    
    const urlParts = imageUrl.split('.');
    if (urlParts.length > 1) {
      const urlExt = urlParts.pop()!.toLowerCase().split(/[#?]/)[0];
      if (validImageExtensions.includes(urlExt)) {
        extension = urlExt;
      }
    }

    const filename = `${cleanBasename}-${imageCounter}.${extension}`;
    imageCounter++;

    // Notify current downloading image
    progressCallback?.({
      currentFile: 'Processing images',
      currentImage: imageUrl
    });

    const downloadPromise = downloadImage(imageUrl)
      .then((buffer) => {
        if (buffer) {
          images[filename] = buffer;
          // Replace with relative path
          newMarkdown = newMarkdown.replace(
            match[1],
            `./attachments/${filename}`
          );
        } else {
          failures.push({
            url: imageUrl,
            filename: filename,
            error: 'Download failed'
          });
          console.warn(`Keeping original URL for failed download: ${imageUrl}`);
        }
        completed++;
        // Update progress
        const progress = (completed / total) * 100;
        window.dispatchEvent(
          new CustomEvent("imageDownloadProgress", {
            detail: { 
              progress,
              url: imageUrl 
            },
          })
        );
      })
      .catch((error) => {
        failures.push({
          url: imageUrl,
          filename: filename,
          error: error.message
        });
        console.warn(`Failed to process image ${imageUrl}:`, error);
        completed++;
      });

    imagePromises.push(downloadPromise);
  }

  await Promise.all(imagePromises);
  return { markdown: newMarkdown, images, failures };
}

// Update Markdown processing function
export async function convertHtmlToMarkdown(
  htmlContent: string,
  url: string,
  metadata?: ArticleMetadata,
  progressCallback?: ProgressCallback
): Promise<{
  markdown: string;
  images: { [filename: string]: ArrayBuffer };
  failures: DownloadFailure[];
}> {
  emitProcessLog('info', `Starting conversion for URL: ${url}`);
  let markdown = createMarkdownContent(htmlContent, url);

  if (metadata) {
    const yamlFrontMatter = Object.entries(metadata)
      .map(
        ([key, value]) =>
          `${key}: ${typeof value === "string" ? `"${value}"` : value}`
      )
      .join("\n");

    markdown = `---\n${yamlFrontMatter}\n---\n\n${markdown}`;
    emitProcessLog('info', `Added YAML front matter for: ${metadata.slug}`);
  }

  // Process images with the markdown filename
  const mdFilename = `${metadata?.slug || 'untitled'}.md`;
  const result = await processMarkdownImages(markdown, mdFilename, metadata, progressCallback);
  emitProcessLog('info', `Completed conversion for URL: ${url}`);
  return result;
}

// Update ZIP processing function
export async function processZipContent(
  htmlFiles: { [key: string]: string },
  metadata: ArticleMetadata[],
  progressCallback?: ProgressCallback
): Promise<{
  results: ConversionResult[];
  failures: { [mdFile: string]: DownloadFailure[] };
}> {
  const results: ConversionResult[] = [];
  const allImages: { [filename: string]: ArrayBuffer } = {};
  const failures: { [mdFile: string]: DownloadFailure[] } = {};

  emitProcessLog('info', `Starting to process ${Object.keys(htmlFiles).length} files`);

  for (const [filename, content] of Object.entries(htmlFiles)) {
    const baseFilename = filename.split("/").pop() || filename;
    const slug = baseFilename.replace(/\.html$/, "");
    const mdFilename = `${slug}.md`;

    emitProcessLog('info', `Processing file: ${mdFilename}`);
    progressCallback?.({
      currentFile: mdFilename
    });

    const articleMetadata = metadata.find((m) => m.slug === slug);

    if (!articleMetadata) {
      emitProcessLog('warning', `No metadata found for ${filename}`);
      console.warn(`No metadata found for ${filename}`);
      continue;
    }

    const { markdown, images, failures: fileFailures } = await convertHtmlToMarkdown(
      content,
      articleMetadata.url,
      articleMetadata,
      progressCallback
    );

    if (fileFailures.length > 0) {
      emitProcessLog('warning', `${fileFailures.length} image download failures in ${mdFilename}`);
      failures[mdFilename] = fileFailures;
    }

    // Merge images
    Object.assign(allImages, images);
    emitProcessLog('info', `Successfully processed ${mdFilename}`);

    results.push({
      filename: mdFilename,
      content: markdown,
    });
  }

  // Add all images to results
  Object.entries(allImages).forEach(([filename, buffer]) => {
    results.push({
      filename: `attachments/${filename}`,
      content: buffer,
      binary: true,
    });
  });

  emitProcessLog('info', `Completed processing all files. Total images: ${Object.keys(allImages).length}`);
  return { results, failures };
}
