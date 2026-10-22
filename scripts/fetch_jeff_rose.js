#!/usr/bin/env node
/**
 * 🕵️‍♂️ CENTS & GOALS - INGESTION BOT (PHASE 1)
 * --------------------------------------------
 * Scrapes the 5 most recent photo posts from Jeff Rose (Good Financial Cents):
 * Target: https://www.facebook.com/GoodFinancialCents/photos
 *
 * For each post, extracts:
 * 1. High-resolution photo (.jpg)
 * 2. Full post caption
 * 3. Author comment by handle (if present)
 * 4. Timestamp & permalink
 *
 * Uploads all 5 photos + today_raw_posts.json to Google Drive "before" subfolder
 * via Google Apps Script Bridge.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const puppeteer = require('puppeteer');

const BASE_DIR = path.resolve(__dirname, '..');
const DOWNLOADS_DIR = path.join(BASE_DIR, 'downloads', 'before');
const RAW_POSTS_JSON_PATH = path.join(DOWNLOADS_DIR, 'today_raw_posts.json');

const APPS_SCRIPT_URL = (process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycby5sEQrjWJpgMRsSEP3utqrTMFWJgVoyLKs-CsI3hEbRNQlNae70S9hp54ophlVY4_6ng/exec').trim();
const TARGET_PAGE_URL = 'https://www.facebook.com/GoodFinancialCents/photos';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function postJsonToAppsScript(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Handle Google Apps Script 302 redirect
        https.get(res.headers.location, r2 => {
          let body = '';
          r2.on('data', c => body += c);
          r2.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { resolve({ raw: body }); }
          });
        }).on('error', reject);
      } else {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { resolve({ raw: body }); }
        });
      }
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function slugify(text) {
  if (!text) return 'post';
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 30);
}

async function scrapeJeffRosePosts() {
  console.log('======================================================');
  console.log('🔍 CENTS & GOALS: FETCHING 5 RECENT POSTS (JEFF ROSE)');
  console.log('======================================================\n');

  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2200 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  console.log(`🌐 Navigating to ${TARGET_PAGE_URL}...`);
  await page.goto(TARGET_PAGE_URL, { waitUntil: 'networkidle2', timeout: 45000 });

  // Scroll gently to load the latest chronological photos
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise(r => setTimeout(r, 2000));

  // Extract distinct photo permalinks
  const rawLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a'))
      .map(a => a.href)
      .filter(h => h.includes('/photo.php') || h.includes('/photo/?fbid=') || h.includes('fbid='));
  });

  const distinctPhotoLinks = [];
  const seenFbids = new Set();
  for (const link of rawLinks) {
    const match = link.match(/fbid=(\d+)/);
    if (match && !seenFbids.has(match[1])) {
      seenFbids.add(match[1]);
      distinctPhotoLinks.push(link);
    }
  }

  console.log(`📸 Identified ${distinctPhotoLinks.length} photo permalinks. Selecting top 5...`);
  const targetLinks = distinctPhotoLinks.slice(0, 5);

  if (targetLinks.length === 0) {
    throw new Error('No photo permalinks found on target Facebook page.');
  }

  const scrapedPosts = [];

  for (let i = 0; i < targetLinks.length; i++) {
    const photoUrl = targetLinks[i];
    console.log(`\n------------------------------------------------------`);
    console.log(`[#${i + 1}/5] Scraping post: ${photoUrl}`);

    const photoPage = await browser.newPage();
    await photoPage.setViewport({ width: 1440, height: 2200 });
    await photoPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    try {
      await photoPage.goto(photoUrl, { waitUntil: 'networkidle2', timeout: 35000 });

      const details = await photoPage.evaluate(() => {
        // 1. High-Res Image
        const imgs = Array.from(document.querySelectorAll('img'))
          .map(img => ({
            src: img.src,
            width: img.naturalWidth || img.width || 0,
            height: img.naturalHeight || img.height || 0
          }))
          .filter(img => img.src.includes('fbcdn.net') && (img.width > 400 || img.height > 400));

        imgs.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        const bestImage = imgs[0] ? imgs[0].src : null;

        // 2. Post Caption
        // Look for the main description container
        const textElements = Array.from(document.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
          .map(el => el.innerText ? el.innerText.trim() : '')
          .filter(t => t.length > 40);

        // Filter out navigation/UI boilerplate
        const cleanTextCandidates = textElements.filter(t => {
          return !t.startsWith('View more comments') &&
                 !t.startsWith('Write a comment') &&
                 !t.includes('Like\nComment') &&
                 !t.includes('All reactions:');
        });

        // The longest substantive text block is usually the author's caption
        cleanTextCandidates.sort((a, b) => b.length - a.length);
        const caption = cleanTextCandidates[0] || '';

        // 3. Creator Comment (Comment by Good Financial Cents or Jeff Rose)
        let authorComment = null;
        const commentBlocks = Array.from(document.querySelectorAll('div[role="article"], div[aria-label*="Comment"]'));
        for (const cb of commentBlocks) {
          const text = cb.innerText || '';
          if (text.includes('Good Financial Cents') || text.includes('Jeff Rose')) {
            // Found author comment
            const commentLines = text.split('\n').filter(l => l.trim().length > 10);
            if (commentLines.length > 1) {
              authorComment = commentLines.slice(1).join('\n').trim();
              break;
            }
          }
        }

        // 4. Timestamp text
        const timeEl = document.querySelector('abbr, span[id*="jsc_"] a, a[role="link"] span');
        const timeText = timeEl ? timeEl.innerText.trim() : new Date().toISOString();

        return {
          imageUrl: bestImage,
          caption: caption,
          authorComment: authorComment,
          timeText: timeText
        };
      });

      if (!details.imageUrl) {
        console.warn(`  ⚠️ Could not find high-res image for post #${i + 1}, skipping.`);
        await photoPage.close();
        continue;
      }

      const postSlug = slugify(details.caption.slice(0, 40));
      const filename = `post_0${i + 1}_${postSlug}.jpg`;
      const localFilePath = path.join(DOWNLOADS_DIR, filename);

      console.log(`  📥 Downloading image to ${filename}...`);
      await downloadFile(details.imageUrl, localFilePath);

      scrapedPosts.push({
        index: i + 1,
        id: `post_0${i + 1}`,
        source_url: photoUrl,
        filename: filename,
        local_path: `downloads/before/${filename}`,
        caption: details.caption,
        author_comment: details.authorComment,
        timestamp: details.timeText,
        extracted_at: new Date().toISOString()
      });

      console.log(`  ✅ Successfully scraped post #${i + 1}!`);
      console.log(`     Caption snippet: "${details.caption.slice(0, 80).replace(/\n/g, ' ')}..."`);
      if (details.authorComment) {
        console.log(`     Author comment: "${details.authorComment.slice(0, 60)}..."`);
      }

    } catch (err) {
      console.error(`  ❌ Failed scraping post #${i + 1}:`, err.message);
    } finally {
      await photoPage.close();
    }
  }

  await browser.close();

  if (scrapedPosts.length === 0) {
    throw new Error('Failed to scrape any posts from Jeff Rose Facebook page.');
  }

  // Save unified metadata JSON locally
  fs.writeFileSync(RAW_POSTS_JSON_PATH, JSON.stringify(scrapedPosts, null, 2) + '\n', 'utf8');
  console.log(`\n💾 Saved local manifest to ${RAW_POSTS_JSON_PATH}`);

  // -------------------------------------------------------------
  // Push to Google Drive "before" Subfolder via Apps Script
  // -------------------------------------------------------------
  console.log('\n======================================================');
  console.log('☁️ UPLOADING RAW ASSETS TO GOOGLE DRIVE ("before")');
  console.log('======================================================\n');

  const filesPayload = [];

  // 1. Add all downloaded JPG photos as base64
  for (const post of scrapedPosts) {
    const filePath = path.join(BASE_DIR, post.local_path);
    if (fs.existsSync(filePath)) {
      const b64 = fs.readFileSync(filePath).toString('base64');
      filesPayload.push({
        filename: post.filename,
        mimeType: 'image/jpeg',
        base64: b64
      });
    }
  }

  // 2. Add captions.json (and today_raw_posts.json) as base64
  const jsonContent = JSON.stringify(scrapedPosts, null, 2);
  const jsonB64 = Buffer.from(jsonContent, 'utf8').toString('base64');
  filesPayload.push({
    filename: 'captions.json',
    mimeType: 'application/json',
    base64: jsonB64
  });
  filesPayload.push({
    filename: 'today_raw_posts.json',
    mimeType: 'application/json',
    base64: jsonB64
  });

  console.log(`📤 Sending ${filesPayload.length} files to Google Apps Script bridge...`);
  const uploadRes = await postJsonToAppsScript({
    action: 'upload_before',
    clearFirst: true,
    files: filesPayload
  });

  if (uploadRes && uploadRes.success) {
    console.log(`✅ SUCCESS! Uploaded ${uploadRes.uploadedCount} files to Google Drive "before" subfolder!`);
  } else {
    console.error('❌ Failed uploading to Google Drive:', uploadRes);
  }

  console.log('\n🎉 Phase 1 (Ingestion) Complete! Ready for Gemini Scheduler Agent.\n');
}

if (require.main === module) {
  scrapeJeffRosePosts().catch(err => {
    console.error('💥 Fatal Ingestion Error:', err);
    process.exit(1);
  });
}

module.exports = { scrapeJeffRosePosts };
