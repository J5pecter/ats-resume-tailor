# Recording sign-ins to a Google Sheet

Every sign-up and sign-in is written to the `AuthEvent` table locally. Point
`SHEETS_WEBHOOK_URL` at a Google Apps Script and each one is also appended as a
row in a spreadsheet.

## What is sent

| Column | Example |
|---|---|
| timestamp | `2026-09-02T16:44:09.455Z` |
| email | `tester.one@example.com` |
| event | `signup`, `login`, `otp_sent`, `otp_failed` |
| method | `password`, `otp`, `google` |
| ip | `203.0.113.7` |
| userAgent | `Mozilla/5.0 …` |

## What is not sent, and cannot be

**The password.** Passwords are stored as bcrypt hashes, which are one-way by
construction — there is no code that recovers the original, here or anywhere.
Putting real passwords in a spreadsheet would mean not hashing them at all, and
a spreadsheet is opened on more laptops, forwarded to more people and left
signed-in on more screens than a database ever is. The address, the moment and
the method answer "who is using this", which is the actual question.

If you need to get someone into their account, the answer is a password reset,
not a lookup.

## Setup

No Google Cloud project, service account or key file — a script bound to the
sheet needs none of that.

1. Create a sheet. First row: `timestamp`, `email`, `event`, `method`, `ip`,
   `userAgent`.
2. **Extensions → Apps Script**, and replace the contents with:

```javascript
const SECRET = 'pick-a-long-random-string';

function doPost(e) {
  const body = JSON.parse(e.postData.contents);

  // Without this, the URL is a public endpoint anyone can append rows to.
  if (body.secret !== SECRET) {
    return ContentService.createTextOutput('forbidden');
  }

  SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().appendRow([
    body.timestamp, body.email, body.event,
    body.method, body.ip, body.userAgent,
  ]);
  return ContentService.createTextOutput('ok');
}
```

3. **Deploy → New deployment → Web app.** Execute as *Me*; who has access
   *Anyone*. Copy the `/exec` URL.

   "Anyone" is required because the app posts without a Google identity. The
   shared secret is what actually guards it, so make it long and put it in both
   places.

4. Set on the service:

```
SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/…/exec
SHEETS_WEBHOOK_SECRET=the-same-long-random-string
```

`/api/status` reports `sheetLogging: true` once it is configured.

## When the sheet is unreachable

Logging never blocks a sign-in. The local `AuthEvent` row is always written
first; the POST has a four-second timeout, and a failure leaves `exported =
false` so the row can be replayed later. A spreadsheet being down must not stop
somebody logging in.
