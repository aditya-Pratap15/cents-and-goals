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
    const parsed = new URL(APPS_SCRIPT_URL);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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

  // Extract distinct photo cards directly from /photos grid
  const rawCards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href*="fbid="]'))
      .map(a => {
        const m = a.href.match(/fbid=(\d+)/);
        const img = a.querySelector('img');
        return {
          fbid: m ? m[1] : null,
          gridImg: img ? img.src : null
        };
      })
      .filter(x => x.fbid && x.fbid !== '782814716377583');
  });

  const distinctCards = [];
  const seenFbids = new Set();
  for (const card of rawCards) {
    if (!seenFbids.has(card.fbid)) {
      seenFbids.add(card.fbid);
      distinctCards.push(card);
    }
  }

  console.log(`📸 Identified ${distinctCards.length} photo cards on grid. Selecting top 5...`);
  const targetCards = distinctCards.slice(0, 5);

  if (targetCards.length === 0) {
    throw new Error('No photo permalinks found on target Facebook page.');
  }

  const scrapedPosts = [];

  for (let i = 0; i < targetCards.length; i++) {
    const card = targetCards[i];
    const photoUrl = `https://www.facebook.com/photo/?fbid=${card.fbid}`;
    console.log(`\n------------------------------------------------------`);
    console.log(`[#${i + 1}/5] Scraping post: ${photoUrl}`);

    const photoPage = await browser.newPage();
    await photoPage.setViewport({ width: 1440, height: 2200 });
    await photoPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    try {
      await photoPage.goto(photoUrl, { waitUntil: 'networkidle2', timeout: 35000 });
      await new Promise(r => setTimeout(r, 2000));

      // Dismiss login popup if present
      try {
        await photoPage.evaluate(() => {
          const closeBtn = document.querySelector('div[aria-label="Close"], [aria-label="Decline optional cookies"]');
          if (closeBtn) closeBtn.click();
        });
      } catch (e) {}

      // Click "See more" text expander to reveal full caption
      try {
        await photoPage.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('*'));
          for (const el of elements) {
            const t = (el.innerText || '').trim().toLowerCase();
            if (t === 'see more' || t === '… see more' || t === 'see more…') {
              el.click();
            }
          }
        });
        await new Promise(r => setTimeout(r, 1200));
      } catch (e) {}

      // Wait for high-res images to render in theater
      await photoPage.waitForSelector('img[src*="scontent"], img[src*="fbcdn"]', { timeout: 4000 }).catch(() => {});

      // Extract high-res image, complete expanded caption, and author comment directly from the photo theater
      const extracted = await photoPage.evaluate((fallbackUrl) => {
        // 1. High-Res Image (Filter for main full-size photo in theater)
        const imgs = Array.from(document.querySelectorAll('img'))
          .map(img => ({
            src: img.src,
            width: img.naturalWidth || img.width || 0,
            height: img.naturalHeight || img.height || 0
          }))
          .filter(img => (img.src.includes('fbcdn.net') || img.src.includes('scontent')) && 
                         !img.src.includes('emoji.php') && 
                         !img.src.includes('/rsrc.php/') &&
                         !img.src.includes('s50x50') &&
                         !img.src.includes('s100x100') &&
                         (img.width > 300 || img.height > 300));
        imgs.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        const bestImg = imgs[0] ? imgs[0].src : fallbackUrl;

        // 2. Author Comment (extract comments made by Good Financial Cents / Author)
        let authorComment = null;
        const commentBlocks = Array.from(document.querySelectorAll('div[role="article"]'));
        for (const cb of commentBlocks) {
          const txt = cb.innerText || '';
          if (txt.includes('Good Financial Cents') || txt.includes('Author')) {
            const parts = txt.split('\n')
              .map(p => p.trim())
              .filter(p => p.length > 20 && 
                           p !== 'Good Financial Cents' && 
                           p !== 'Author' && 
                           !p.includes('Like') && 
                           !p.includes('Reply'));
            if (parts.length > 0) {
              authorComment = parts[0];
              break;
            }
          }
        }

        // 3. Caption (Substantive post text from photo viewer)
        const textNodes = Array.from(document.querySelectorAll('span[dir="auto"], div[dir="auto"]'))
          .map(s => (s.innerText || '').trim())
          .filter(t => t.length > 40 &&
                       !t.includes('view post') &&
                       !t.includes('All reactions:') &&
                       !t.includes('Write a comment') &&
                       !t.includes('Most relevant') &&
                       !t.includes('United States') &&
                       !t.startsWith('Log in') &&
                       !t.startsWith('Create new account') &&
                       !t.startsWith('Email address') &&
                       !t.startsWith('Forgotten account') &&
                       t !== authorComment);

        let caption = textNodes[0] || '';
        caption = caption.replace(/\s*See less$/i, '').trim();

        const timeEl = document.querySelector('abbr, a[role="link"] span');
        const timeText = timeEl ? timeEl.innerText.trim() : 'Recent';

        return {
          imageUrl: bestImg,
          caption: caption,
          authorComment: authorComment,
          timeText: timeText
        };
      }, card.gridImg);

      const details = extracted;

      if (!details.imageUrl) {
        console.warn(`  ⚠️ Could not find high-res image for post #${i + 1}, skipping.`);
        continue;
      }

      const postSlug = slugify(details.caption.slice(0, 40)) || 'photo';
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
        public_image_url: details.imageUrl,
        raw_cdn_url: details.imageUrl,
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
      if (photoPage && !photoPage.isClosed()) {
        await photoPage.close().catch(() => {});
      }
    }
  }

  if (browser) {
    await browser.close().catch(() => {});
  }

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

  const photoPayload = [];

  // 1. Add all downloaded JPG photos as base64
  for (const post of scrapedPosts) {
    const filePath = path.join(BASE_DIR, post.local_path);
    if (fs.existsSync(filePath)) {
      const b64 = fs.readFileSync(filePath).toString('base64');
      photoPayload.push({
        filename: post.filename,
        mimeType: 'image/jpeg',
        base64: b64
      });
    }
  }

  console.log(`📤 Uploading ${photoPayload.length} photos to Google Drive "before" subfolder...`);
  const uploadRes = await postJsonToAppsScript({
    action: 'upload_before',
    clearFirst: true,
    files: photoPayload
  });

  if (uploadRes && uploadRes.success) {
    console.log(`✅ Uploaded ${uploadRes.uploadedCount} photos successfully!`);
    
    // Map Google Drive file IDs and high-speed CDN URLs (lh3.googleusercontent.com/d/)
    if (Array.isArray(uploadRes.files)) {
      for (const post of scrapedPosts) {
        const match = uploadRes.files.find(f => f.name === post.filename);
        if (match) {
          post.drive_file_id = match.id;
          post.drive_direct_url = match.directUrl || `https://lh3.googleusercontent.com/d/${match.id}`;
        }
      }
    }
  } else {
    console.error('❌ Failed uploading photos to Google Drive:', uploadRes);
  }

  // 2. Save enriched manifest locally and upload captions.json to Drive
  fs.writeFileSync(RAW_POSTS_JSON_PATH, JSON.stringify(scrapedPosts, null, 2) + '\n', 'utf8');
  console.log(`💾 Updated local manifest with direct CDN URLs at ${RAW_POSTS_JSON_PATH}`);

  const jsonContent = JSON.stringify(scrapedPosts, null, 2);
  const jsonB64 = Buffer.from(jsonContent, 'utf8').toString('base64');

  console.log(`📤 Uploading captions.json with public & direct URLs to Google Drive...`);
  const jsonUploadRes = await postJsonToAppsScript({
    action: 'upload_before',
    clearFirst: false,
    files: [{
      filename: 'captions.json',
      mimeType: 'application/json',
      base64: jsonB64
    }]
  });

  if (jsonUploadRes && jsonUploadRes.success) {
    console.log(`✅ SUCCESS! captions.json is now live in Google Drive "before" subfolder!`);
  } else {
    console.error('❌ Failed uploading captions.json:', jsonUploadRes);
  }

  console.log('\n🎉 Phase 1 (Ingestion) Complete! Ready for Gemini / Meta AI Scheduler Agent.\n');
}

if (require.main === module) {
  scrapeJeffRosePosts().catch(err => {
    console.error('💥 Fatal Ingestion Error:', err);
    process.exit(1);
  });
}

module.exports = { scrapeJeffRosePosts };
