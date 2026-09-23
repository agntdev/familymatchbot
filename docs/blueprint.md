# SeriousMatch — dating for long‑term relationships — Bot specification

**Archetype:** community

**Voice:** warm and respectful — write every user-facing message, button label, error, and empty state in this voice.

A Telegram-first dating bot for adults seeking serious relationships and family formation. Users create a private profile (photos, bio, preferences), browse curated one‑card profiles via inline buttons, like to create matches, and message only mutual matches. Owner/admin receives report and signup alerts; all interaction is primarily button-driven with typed input only for free text and photo uploads.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Adults seeking long‑term relationships and family
- Users who prefer curated, safety‑focused matching
- Russian‑speaking audience (primary)

## Success criteria

- 80% of new signups complete a minimum viable profile (name, age, gender, city, 1–3 photos, bio) within their first session
- Mutual likes produce matches and open messaging reliably (deliver message success rate > 99%)
- All reports and new signup notifications are delivered to ADMIN_CHAT_ID within 10s
- Profile browsing yields appropriate matches within configured filters (age/city/gender) in 95% of trials

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu and welcome card
- **Create profile** (button, actor: user, callback: profile:create:start) — Begin the guided profile creation wizard
  - inputs: typed name, typed age, typed city, photo messages (1–6), typed bio, preference selections
  - outputs: draft profile stored, profile preview message, confirmation and profile published
- **Browse profiles** (button, actor: user, callback: browse:start) — Open the discovery queue (one profile card at a time)
  - inputs: optional filter adjustments (age range, city, gender), callback: Like/Pass/Report/View full
  - outputs: profile cards, like record / match event, report sent to admin
- **My profile** (button, actor: user, callback: profile:manage) — View and edit your profile, visibility and preferences
  - inputs: edit actions via inline buttons, typed updates for free‑text fields
  - outputs: profile updated confirmation
- **Likes** (button, actor: user, callback: likes:list) — See people who liked you; accept to create a match or ignore
  - inputs: accept/ignore via inline buttons
  - outputs: match created when accepted and mutual, notification to other party on match
- **Messages** (button, actor: user, callback: conversations:list) — List active conversations available only with mutual matches
  - inputs: select conversation, typed message
  - outputs: message delivered to matched user, read/unread state updated
- **Settings** (button, actor: user, callback: settings:open) — Edit search filters, visibility, safety options, or delete account
  - inputs: filter values via inline buttons, confirmation for delete via inline buttons
  - outputs: settings updated, account deleted (if confirmed)

## Flows

### Create profile wizard
_Trigger:_ /start -> Create profile button or profile:create:start

1. Consent step: confirm seeking serious relationship (inline Yes/No). Block progression if No.
2. Collect name (ForceReply typed), validate non-empty
3. Collect age (ForceReply typed), validate >= 18
4. Collect gender (inline options), optional custom
5. Collect city (ForceReply typed) and optional distance preference
6. Request photo uploads (1–6) via Telegram media messages; accept multiple messages; validate count and file types
7. Collect bio (ForceReply typed) and optional fields (religion/values, smoking/drinking) via inline prompts
8. Collect preferred partner age range and gender via inline pickers
9. Preview card (photo carousel media group or single preview with link to full preview) with Confirm/Edit
10. On Confirm -> save profile as visible (published) and notify owner (new signup) to ADMIN_CHAT_ID

_Data touched:_ user_profile, photos, preferences

### Browse profiles & interaction
_Trigger:_ Browse profiles button or browse:start

1. Load browsing queue filtered by user's preferences (age/gender/city/distance)
2. Present next profile as a card with primary photo, short bio snippet and inline actions: Like, Pass, Report, View full profile
3. On Like -> create 'like' record; check reciprocal like and if mutual create Match and open messaging for both users; send notifications to both users
4. On Pass -> mark profile as passed in user's session; advance to next card
5. On Report -> open report reason (inline list + optional typed detail) then send report to ADMIN_CHAT_ID with profile snapshot and reporter id; mark profile for moderation

_Data touched:_ browsing_queue, likes, matches, reports

### Likes management (incoming)
_Trigger:_ Likes button or likes:list

1. Show list (paginated) of recent users who liked you with small card and inline actions: Accept (create match), Ignore, View profile
2. On Accept -> check partner also liked you; if mutual create match and open messaging; if not mutual still create match only when partner likes back or owner decides? (default: only mutual -> match)
3. On Ignore -> mark like as ignored and remove from list

_Data touched:_ likes, matches

### Messaging between matches
_Trigger:_ conversations:list -> select conversation

1. List active conversations (match id, name, unread count) via inline list
2. Open conversation: display recent messages, timestamps, read/unread state
3. Send message: typed reply (ForceReply) -> persist message, deliver via Telegram to matched user, mark unread for recipient
4. If recipient blocked/deleted match, prevent sending and show error

_Data touched:_ messages, matches

### Account settings & deletion
_Trigger:_ Settings -> settings:open

1. Show settings menu: Edit profile, Search filters, Visibility toggle (on/off), Safety & report options, Delete account
2. Edit profile fields via the same small wizards (typed or inline)
3. Delete account -> confirm with two-step inline confirmation; on confirm remove profile and associated personal data, notify ADMIN_CHAT_ID

_Data touched:_ user_profile, preferences, messages

### Report & admin notification
_Trigger:_ Report action on a profile

1. Collect reason via inline options (Spam, Inappropriate photos, Fake profile, Harassment, Other) with optional typed details
2. Attach profile snapshot and recent messages (if any) and send structured report to ADMIN_CHAT_ID
3. Acknowledge reporter with thanks and optional safety guidance
4. Owner may act via admin tools (ban/hide or request more info)

_Data touched:_ reports, user_profile, messages

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Where new signups and safety reports are sent (your Telegram chat id)
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **user_profile** _(retention: persistent)_ — Primary profile data for each user
  - fields: user_id (Telegram id), name, age, gender, city, photos (1–6 references), short_bio, relationship_intent (confirmed serious), children_preference, religion_values (optional), smoking_drinking, preferred_partner_age_range, preferred_partner_gender, visibility (on/off), created_at, updated_at
- **browsing_queue** _(retention: session)_ — Per‑user ephemeral queue of candidate profile ids ordered by filters and activity
  - fields: user_id, profile_ids_ordered, cursor_position, applied_filters
- **likes** _(retention: persistent)_ — Records of one user liking another
  - fields: from_user_id, to_user_id, timestamp, status (pending/ignored/matched)
- **matches** _(retention: persistent)_ — Mutual likes that enable messaging
  - fields: match_id, user_a_id, user_b_id, matched_at, active (true/false)
- **messages** _(retention: persistent)_ — Direct messages exchanged between matched users
  - fields: message_id, match_id, from_user_id, to_user_id, text, attachments (photo refs), sent_at, read_at, delivered
- **photos** _(retention: persistent)_ — Stored photo files or references uploaded by users
  - fields: photo_id, owner_user_id, file_ref, uploaded_at
- **reports** _(retention: persistent)_ — User safety reports submitted against profiles or messages
  - fields: report_id, reporter_user_id, target_user_id, target_snapshot (profile fields and photos), reason, details, time, admin_action

## Integrations

- **Telegram** (required) — Bot API messaging, media upload and inline callback handling
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Receive ADMIN_CHAT_ID notifications for new signups and reports
- Review reports and take actions (hide/ban profile, request more info)
- Configure or update search / matching defaults (location priority, age priority)
- Manually deactivate accounts and request data deletion
- Adjust content policy messaging (safety text shown to users)

## Notifications

- User-facing: new like received, new mutual match, new message from match, report submitted confirmation
- Owner-facing: new signup notification, new report/safety flag with profile snapshot and reporter details
- System-facing: delivery failures or storage errors to owner/admin (if severe)

## Permissions & privacy

- Users must confirm they are 18+ and seeking serious relationships before profile creation proceeds
- Profiles are private by default until the user confirms publishing during creation
- Messaging is allowed only between mutual matches to reduce unsolicited contact
- Photos and profile data are stored persistently; users may delete their account which removes their data (implement delete pipeline and admin notification)
- Reports include profile snapshot sent to ADMIN_CHAT_ID for manual moderation; no public exposure
- Owners must not receive BOT_TOKEN or other secrets; only ADMIN_CHAT_ID is required

## Edge cases

- User uploads zero or too few photos: wizard enforces minimum (1) and suggests 1–3 for MVP
- Simultaneous likes leading to race condition: ensure atomic check-and-create match transaction
- User deletes account mid‑conversation: messages should be flagged; matched partner informed that the account was deleted
- Photo upload failures or unsupported formats: reject and prompt resend
- Users trying to message without a mutual match: block and show explanation
- Duplicate accounts for same Telegram id: prevent by using Telegram id as unique key
- Location mismatches where city text is ambiguous: fallback to city string matching; geocoding is a missing field
- High volume of reports: provide batching to ADMIN_CHAT_ID and simple moderation commands

## Required tests

- Dialog-level acceptance test: complete profile creation (including photos) and publish -> profile visible in browsing
- Browse flow test: filters applied, Like -> mutual like sequence, match created and messages permitted
- Messaging test: send/receive between matched users, unread/read transitions
- Report flow test: report a profile, ADMIN_CHAT_ID receives structured report with snapshot and attachments
- Persistence test: profiles, likes, matches and messages survive restart and are queryable
- Visibility test: visibility toggle hides/unhides profile from browse queues
- Edge-case tests: photo upload errors, minimum photo enforcement, under‑18 blocking, account deletion cleanup

## Assumptions

- Primary language is Russian and UI text will be written formally for serious daters
- Minimum viable profile required fields: name, age, gender, city, 1–3 photos, short bio
- Photo limit is up to 6 photos; default recommended 1–3 to reduce storage
- Discovery order: prioritize location and age-range match then recent activity
- No payments or premium features in MVP; they may be added later
- No automated content moderation (human moderation via ADMIN_CHAT_ID for reports)
