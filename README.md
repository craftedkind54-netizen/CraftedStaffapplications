# Crafted SMP Staff Application Bot

Discord bot for managing Crafted SMP staff applications, testing, interview scheduling, private interview channels, interviewer scoring, and results.

## Files

- `index.js` — Complete bot code
- `package.json` — Node.js packages and start command
- `README.md` — Setup instructions

## 1. Environment Variable

Create this environment variable on your hosting service:

```text
DISCORD_TOKEN=YOUR_BOT_TOKEN
```

Do **not** put your Discord bot token directly inside `index.js`.

## 2. Install Packages

Run:

```bash
npm install
```

The required packages are installed automatically from `package.json`.

## 3. Start the Bot

Run:

```bash
npm start
```

## 4. Discord Developer Portal

Under your bot's **Privileged Gateway Intents**, enable:

- Server Members Intent

The bot is designed to be invited with **Administrator** permission.

## 5. Configured Crafted SMP Roles

- Owner: `1546564866045902978`
- Co-Owner: `1548519417992974356`
- Senior Staff: `1543367669385011302`

## 6. Configured Channels / Categories

- Application Control: `1548840885167587399`
- Submitted Applications: `1548841190609129522`
- Interview Notifications: `1548846551890137189`
- Interview Results: `1548849111179067472`
- Main Category: `1543364258308300840`
- Senior Staff Category: `1543368484220571658`

## 7. Test Before Going Public

Start the bot and use **Testing Mode** first.

Test the complete workflow:

1. Enable Testing Mode.
2. Select a test applicant.
3. Submit a test application.
4. Test Senior Staff approvals.
5. Test Owner/Co-Owner approval.
6. Test rescheduling.
7. Test interview confirmation.
8. Simulate all three reminders.
9. Start the interview.
10. Confirm private channel permissions.
11. Test all 21 scored questions.
12. Test both interviewers scoring independently.
13. Restart the bot during an interview and verify data remains.
14. End the interview.
15. Verify the final score calculation.
16. Test Accept, Reject, and Further Review.
17. Reset test data.
18. Only enable Public Applications after testing succeeds.

## Important

Do not announce public staff applications until Testing Mode has been completed successfully.
