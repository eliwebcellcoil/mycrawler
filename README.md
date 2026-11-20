# mycrawler

סורק אתר ומייצר מירור מקומי. איפיון וארכיטקטורה: SPEC.md.

## אתר (UI)
`npm start` ואז http://127.0.0.1:3000 (או `docker build -t mycrawler . && docker run -p 3000:3000 -e HOST=0.0.0.0 mycrawler`).

## CLI
`node cli.js https://example.com out --max-pages 200`

## GitHub Action
Actions - Mirror site - Run workflow - להזין URL. המירור יורד כ-artifact בשם site-mirror.

בדיקות: `npm test`

## GitHub Pages
Settings - Pages - Source: GitHub Actions. הדף https://eliwebcellcoil.github.io/mycrawler/ מפעיל סריקה (דורש token עם Actions: write) והמירור האחרון מתפרסם תחת /mirror/.
