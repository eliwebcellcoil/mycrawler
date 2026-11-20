# Site Mirror - איפיון וארכיטקטורה

## מטרה
אפליקציית ווב מקומית: מזינים קישור, המערכת סורקת (crawl) את כל האתר ומייצרת מירור סטטי מקומי שניתן לגלישה אופליין.

## דרישות פונקציונליות
1. קלט: URL התחלתי + אפשרויות (מקסימום דפים, עומק, מקביליות, תתי-דומיינים, נכסים חיצוניים, robots.txt).
2. סריקה BFS של כל הדפים באותו דומיין (www ו-non-www נחשבים זהים).
3. הורדת נכסים: CSS, JS, תמונות, פונטים, וידאו, PDF, favicon, srcset, url() בתוך CSS, @import.
4. כתיבת קישורים מחדש (rewrite) ליחסיים - המירור עובד גם מ-file:// וגם משרת.
5. התקדמות חיה בזמן אמת (SSE): דפים, נכסים, שגיאות, נפח, קובץ נוכחי.
6. ביטול משימה, רשימת משימות קודמות, פתיחת המירור בלחיצה.
7. דוח סיום: מפת URL לקובץ, רשימת כשלונות.

## דרישות לא פונקציונליות
- אפס תלויות חיצוניות (Node 18+ בלבד).
- ברירת מחדל: האזנה ל-127.0.0.1 בלבד (הגנת SSRF), שימוש מקומי.
- הגנת path traversal בהגשת קבצים.
- הגבלת גודל קובץ, timeout, ניסיון חוזר אחד.
- מכבד robots.txt כברירת מחדל, השהיה מוגדרת בין בקשות.

## מחוץ לטווח (גרסה 1)
רינדור JavaScript (SPA) - מירור של HTML כפי שהשרת מחזיר. הרחבה עתידית: מצב Playwright.

## ארכיטקטורה

```
Browser UI (public/index.html)
   | REST + SSE
server.js  --- jobs registry, static serving of mirrors
   |
crawler.js --- Crawler (EventEmitter): queue, workers, fetch, save
   |
rewrite.js --- transformHtml / transformCss (חילוץ + כתיבה מחדש)
paths.js   --- URL -> local file path (דטרמיניסטי, ללא התנגשויות)
```

### זרימה
1. POST /api/jobs - יוצר Job ומפעיל Crawler.
2. שלב סריקה: תור (url, depth, kind). Worker מוריד, שומר raw, מחלץ קישורים (rewrite.js במצב חילוץ), מוסיף לתור.
3. שלב כתיבה מחדש: לכל HTML/CSS שנשמר, מחליפים כל הפניה בנתיב יחסי לפי מפת url->local. הפניה שלא הורדה הופכת ל-URL מוחלט.
4. כתיבת `job.json` (דוח) והודעת done.

### מבנה דיסק
```
mirrors/<jobId>/job.json      מטא-דאטה + דוח
mirrors/<jobId>/content/      המירור עצמו (host ראשי בשורש, חיצוניים תחת _ext/<host>/)
```

### כללי מיפוי נתיב
- `/` או נתיב שנגמר ב-`/` -> `index.html`
- HTML בלי סיומת -> `<path>/index.html`; HTML עם סיומת אחרת (php, asp) -> מוסיפים `.html`
- query string -> סיומת `_q<hash8>` לפני הסיומת
- ניקוי תווים אסורים, קיצור שמות, פתרון התנגשויות לפי hash

### API
| Method | Path | תיאור |
|---|---|---|
| POST | /api/jobs | יצירת משימה |
| GET | /api/jobs | רשימה |
| GET | /api/jobs/:id/events | SSE התקדמות |
| POST | /api/jobs/:id/cancel | ביטול |
| GET | /mirrors/:id/* | הגשת המירור |
