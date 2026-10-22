const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  
  await page.goto('https://www.facebook.com/photo.php?fbid=1937956144196762&set=pb.100039471860412.-2207520000&type=3', { waitUntil: 'networkidle2', timeout: 35000 });
  
  const postData = await page.evaluate(() => {
    // 1. Photo
    const imgs = Array.from(document.querySelectorAll('img')).map(i => ({
      src: i.src,
      w: i.naturalWidth || i.width,
      h: i.naturalHeight || i.height,
      alt: i.alt || ''
    }));
    imgs.sort((a,b) => (b.w * b.h) - (a.w * a.h));
    
    // 2. Text Candidates
    const texts = Array.from(document.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
      .map(s => s.innerText.trim())
      .filter(t => t.length > 25);
      
    // 3. Comments
    const comments = [];
    const commentEls = Array.from(document.querySelectorAll('div[role="article"]'));
    for (const c of commentEls) {
      const txt = c.innerText || '';
      if (txt.includes('Author') || txt.includes('Good Financial Cents')) {
        comments.push(txt);
      }
    }
    
    return {
      mainImg: imgs[0],
      texts: texts.slice(0, 8),
      comments: comments
    };
  });
  
  console.log('Main image:', postData.mainImg);
  console.log('Texts:', postData.texts);
  console.log('Comments:', postData.comments);
  
  await browser.close();
})();
