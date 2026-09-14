require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  Events,
  MessageFlags,
} = require('discord.js');

const Database = require('better-sqlite3');
const { DateTime } = require('luxon');

// =====================================================
// CRAFTED SMP STAFF APPLICATION BOT
// =====================================================

const GUILD_ID = '1543363950262100118';

const APPLICATION_CONTROL_CHANNEL_ID = '1548840885167587399';
const SUBMITTED_APPLICATIONS_CHANNEL_ID = '1548841190609129522';
const INTERVIEW_NOTIFICATION_CHANNEL_ID = '1548846551890137189';

// Permanent results + notes go here.
// If you want a different channel later, only replace this ID.
const INTERVIEW_RESULTS_CHANNEL_ID = '1548849111179067472';

const MAIN_CATEGORY_ID = '1543364258308300840';
const SCORING_CATEGORY_ID = '1548862844186001478';

const OWNER_ROLE_ID = '1546564866045902978';
const CO_OWNER_ROLE_ID = '1548519417992974356';
const SENIOR_STAFF_ROLE_ID = '1543367669385011302';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// =====================================================
// DATABASE
// =====================================================

const db = new Database('crafted_staff_applications.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'real',
  age TEXT NOT NULL,
  experience TEXT NOT NULL,
  interview_ts INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'PENDING',
  status TEXT NOT NULL DEFAULT 'choosing_time',
  submission_message_id TEXT,
  interview_text_channel_id TEXT,
  interview_voice_channel_id TEXT,
  scoring_channel_id TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS approvals (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(app_id, staff_id)
);

CREATE TABLE IF NOT EXISTS interviewers (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  added_by TEXT,
  PRIMARY KEY(app_id, staff_id)
);

CREATE TABLE IF NOT EXISTS category_progress (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  category_index INTEGER NOT NULL,
  selected_questions TEXT NOT NULL DEFAULT '[]',
  score INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(app_id, staff_id, category_index)
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  app_id INTEGER NOT NULL,
  staff_id TEXT NOT NULL,
  current_category INTEGER NOT NULL DEFAULT -1,
  finished INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(app_id, staff_id)
);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('applications', 'submission_message_id', 'TEXT');
ensureColumn('applications', 'interview_text_channel_id', 'TEXT');
ensureColumn('applications', 'interview_voice_channel_id', 'TEXT');
ensureColumn('applications', 'scoring_channel_id', 'TEXT');
ensureColumn('applications', 'completed_at', 'INTEGER');
ensureColumn('interviewers', 'added_by', 'TEXT');

// =====================================================
// BRIEFS
// =====================================================

const OPENING_BRIEF = [
  '**Welcome to the Moderator Application Process!**',
  '',
  'Thank you for your interest in helping make our SMP a fun, fair, and welcoming community. Moderators are expected to be mature, active, respectful, and capable of handling situations professionally.',
  '',
  'Please answer all questions honestly and in detail.',
  '',
  'You have about **1 minute to answer each question**. Questions that are not answered, or have a 5–10 second delay, may be skipped and can impact your score.',
  '',
  '**This meeting is recorded and reviewed.**',
  '',
  'You will be graded based on your performance during the meeting.',
  '',
  '🛡️ **Trial Moderator Promotion Board**',
].join('\n');

const CLOSING_BRIEF = [
  '**🏁 Interview Closing Brief**',
  '',
  'Thank you for completing the Crafted SMP Moderator interview.',
  '',
  'Staff will now finish reviewing your interview performance.',
  '',
  'Your responses, professionalism, judgment, and overall performance will be considered.',
  '',
  'Please do not ask interviewers for your score or result during or immediately after the interview.',
  '',
  'Staff will handle the final decision privately.',
  '',
  'Thank you for taking the time to participate in the **Trial Moderator Promotion Board**.',
].join('\n');

// =====================================================
// QUESTIONS
// =====================================================

const QUESTION_CATEGORIES = [
  {
    name: '📖 General Knowledge',
    code: 'DE',
    questions: [
      { number: 1, text: 'Why do you want to become a Moderator?' },
      { number: 2, text: 'What do you believe the role of a moderator is?' },
      { number: 3, text: 'What qualities make an excellent moderator?' },
      { number: 4, text: 'What does fairness mean to you?' },
      { number: 5, text: 'Why is professionalism important when moderating a community?' },
    ],
  },
  {
    name: '🤝 Community & Leadership',
    code: '',
    questions: [
      { number: 6, text: 'How would you help new players feel welcomed on the SMP?' },
      { number: 7, text: 'What would you do to improve the community experience?' },
      { number: 8, text: 'How do you handle disagreements with other people?' },
      { number: 9, text: 'What makes a good leader?' },
      { number: 10, text: 'Why should the staff team trust you with moderation permissions?' },
    ],
  },
  {
    name: '⚖️ Rule Enforcement Scenarios',
    code: 'KI',
    questions: [
      { number: 12, text: 'You witness a player using inappropriate language in global chat. What actions would you take?' },
      { number: 13, text: 'A player is intentionally trying to provoke others into breaking rules. How would you deal with this?' },
      { number: 14, text: 'A player is bypassing chat filters and is repeatedly spamming chat after multiple warnings. How would you handle the situation? send inappropriate messages. What would you do?' },
      { number: 15, text: 'Several players report someone for hacking, but there is no evidence. What steps would you take before making a decision?' },
    ],
  },
  {
    name: '🔥 Advanced Scenario Questions',
    code: 'DE',
    questions: [
      { number: 16, text: 'One of your close friends is caught cheating. They ask you not to report them. What would you do and why?' },
      { number: 17, text: 'A popular player is breaking rules, but many community members defend them because they are well-known. How would you handle the situation?' },
      { number: 18, text: 'You accidentally punish the wrong player. What would you do next?' },
      { number: 19, text: 'Another moderator gives a punishment that you believe is unfair. How would you address the situation?' },
      { number: 20, text: 'You are the only staff member online and multiple issues happen at the same time:\n• A player is spamming.\n• Someone reports a hacker.\n• Two players are arguing in chat.\nHow would you prioritize and handle each situation?' },
    ],
  },
  {
    name: '🧠 Judgment & Decision Making',
    code: '',
    questions: [
      { number: 21, text: 'What would you do if you were unsure how to handle a moderation situation?' },
      { number: 22, text: 'When should a moderator ask for help from higher-ranking staff?' },
      { number: 23, text: 'What is more important:\n• Being liked by players\n• Enforcing rules fairly\nExplain your answer.' },
      { number: 24, text: 'How would you respond to a player who becomes angry after receiving a punishment?' },
      { number: 25, text: 'What would you do if someone accused you of staff abuse?' },
    ],
  },
  {
    name: '🚨 Serious Staff Scenarios',
    code: '',
    questions: [
      { number: 26, text: 'You discover another staff member abusing their permissions. What actions would you take?' },
      { number: 27, text: 'A player privately tells you they found a duplication exploit that could harm the economy. What would you do?' },
      { number: 28, text: 'A player threatens to leave the server unless their punishment is removed. How would you respond?' },
      { number: 29, text: 'You find evidence that a staff member is leaking private staff information. What would you do?' },
      { number: 30, text: 'A player creates multiple alternate accounts to evade punishments. How would you investigate and handle the situation?' },
    ],
  },
  {
    name: '🎭 Bonus Question (Troll Check)',
    code: 'DE',
    questions: [
      { number: 34, text: 'You are given Owner rank for 5 minutes. What is the very first thing you do?\n\n(This question is designed to test maturity, judgment, and whether applicants think about helping the server rather than abusing power.)' },
      { number: 35, text: 'As A moderator you contain role of leadership and persuasion right now persuasive to us with out breaking character why ketchup should be a soup' },
      { number: 36, text: 'As being persuasive explain why should noodles be on a pizza' },
      { number: 37, text: 'Ask them to explain how coffee can be a type of tea' },
    ],
  },
];

const CATEGORY_COUNT = QUESTION_CATEGORIES.length;
const MAX_SCORE_PER_INTERVIEWER = CATEGORY_COUNT * 3;
const MAX_WEEKS = 12;

// =====================================================
// TIME OPTIONS
// =====================================================

const TIME_OPTIONS = [
  ['08:00', '8:00 AM'],
  ['08:30', '8:30 AM'],
  ['09:00', '9:00 AM'],
  ['09:30', '9:30 AM'],
  ['10:00', '10:00 AM'],
  ['10:30', '10:30 AM'],
  ['11:00', '11:00 AM'],
  ['11:30', '11:30 AM'],
  ['12:00', '12:00 PM'],
  ['12:30', '12:30 PM'],
  ['13:00', '1:00 PM'],
  ['13:30', '1:30 PM'],
  ['14:00', '2:00 PM'],
  ['14:30', '2:30 PM'],
  ['15:00', '3:00 PM'],
  ['15:30', '3:30 PM'],
  ['16:00', '4:00 PM'],
  ['16:30', '4:30 PM'],
  ['17:00', '5:00 PM'],
  ['17:30', '5:30 PM'],
  ['18:00', '6:00 PM'],
  ['18:30', '6:30 PM'],
  ['19:00', '7:00 PM'],
  ['19:30', '7:30 PM'],
  ['20:00', '8:00 PM'],
];

const TIMEZONE_OPTIONS = [
  {
    label: 'HST — Hawaii',
    value: 'HST',
    description: 'Hawaii Standard Time',
  },
  {
    label: 'Pacific',
    value: 'PACIFIC',
    description: 'PST / PDT',
  },
  {
    label: 'Mountain',
    value: 'MOUNTAIN',
    description: 'MST / MDT',
  },
  {
    label: 'Central',
    value: 'CENTRAL',
    description: 'CST / CDT',
  },
  {
    label: 'Eastern',
    value: 'EASTERN',
    description: 'EST / EDT',
  },
];

const TIMEZONE_ZONES = {
  HST: 'Pacific/Honolulu',
  PACIFIC: 'America/Los_Angeles',
  MOUNTAIN: 'America/Denver',
  CENTRAL: 'America/Chicago',
  EASTERN: 'America/New_York',
};

// =====================================================
// HELPERS
// =====================================================

function getSetting(key, fallback = null) {
  return (
    db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).get(key)?.value ?? fallback
  );
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `).run(
    key,
    String(value)
  );
}

if (!getSetting('system_mode')) {
  setSetting(
    'system_mode',
    'closed'
  );
}

function getApplication(id) {
  return db.prepare(
    'SELECT * FROM applications WHERE id = ?'
  ).get(id);
}

function getApprovals(appId) {
  return db.prepare(`
    SELECT staff_id
    FROM approvals
    WHERE app_id = ?
    ORDER BY created_at
  `)
    .all(appId)
    .map(
      row =>
        row.staff_id
    );
}

function getInterviewers(appId) {
  return db.prepare(`
    SELECT staff_id
    FROM interviewers
    WHERE app_id = ?
  `)
    .all(appId)
    .map(
      row =>
        row.staff_id
    );
}

function hasRole(
  member,
  roleId
) {
  return Boolean(
    member?.roles?.cache?.has(
      roleId
    )
  );
}

function isOwnerOrCoOwner(
  member
) {
  return (
    hasRole(
      member,
      OWNER_ROLE_ID
    ) ||
    hasRole(
      member,
      CO_OWNER_ROLE_ID
    )
  );
}

function isSenior(member) {
  return hasRole(
    member,
    SENIOR_STAFF_ROLE_ID
  );
}

function isAuthorizedStaff(
  member
) {
  return (
    isOwnerOrCoOwner(
      member
    ) ||
    isSenior(
      member
    )
  );
}

function unixNow() {
  return Math.floor(
    Date.now() /
    1000
  );
}

function slugify(text) {
  return (
    text ||
    'applicant'
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      '-'
    )
    .replace(
      /^-+|-+$/g,
      ''
    )
    .slice(
      0,
      70
    ) ||
    'applicant';
}

function statusLabel(
  status
) {
  const map = {
    choosing_time:
      '📅 Choosing Interview Time',

    pending:
      '🟡 Pending Review',

    needs_time:
      '🟠 Needs Different Time',

    confirmed:
      '🟢 Interview Confirmed',

    in_progress:
      '🔵 Interview In Progress',

    completed:
      '✅ Interview Completed',

    accepted:
      '✅ Accepted',

    rejected:
      '🔴 Rejected',

    cancelled:
      '⚫ Cancelled',

    further_review:
      '🟡 Further Review',
  };

  return (
    map[status] ||
    status
  );
}

async function fetchTextChannel(
  id
) {
  if (!id) {
    return null;
  }

  const channel =
    await client.channels
      .fetch(
        id
      )
      .catch(
        () =>
          null
      );

  return channel?.isTextBased()
    ? channel
    : null;
}

async function safeEphemeral(
  interaction,
  content
) {
  if (
    interaction.replied ||
    interaction.deferred
  ) {
    return interaction
      .followUp({
        content,
        flags:
          MessageFlags.Ephemeral,
      })
      .catch(
        () =>
          null
      );
  }

  return interaction
    .reply({
      content,
      flags:
        MessageFlags.Ephemeral,
    })
    .catch(
      () =>
        null
    );
}

function staffPermissions(
  guild,
  applicantId = null
) {
  const overwrites = [
    {
      id:
        guild.roles.everyone.id,

      deny: [
        PermissionFlagsBits.ViewChannel,
      ],
    },

    {
      id:
        OWNER_ROLE_ID,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },

    {
      id:
        CO_OWNER_ROLE_ID,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },

    {
      id:
        SENIOR_STAFF_ROLE_ID,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (
    applicantId
  ) {
    overwrites.push({
      id:
        applicantId,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  return overwrites;
}

// =====================================================
// WEEK / DATE / TIME PICKER
// =====================================================

function minimumSelectableDate(
  app
) {
  const today =
    DateTime.now()
      .setZone(
        'Pacific/Honolulu'
      )
      .startOf(
        'day'
      );

  return app.mode ===
    'real'
    ? today.plus({
        days: 7,
      })
    : today;
}

function weekStartFor(
  app,
  weekIndex
) {
  return minimumSelectableDate(
    app
  ).plus({
    days:
      Number(
        weekIndex
      ) *
      7,
  });
}

function buildWeekPicker(
  app
) {
  const options = [];

  for (
    let i = 0;
    i < MAX_WEEKS;
    i++
  ) {
    const start =
      weekStartFor(
        app,
        i
      );

    const end =
      start.plus({
        days: 6,
      });

    options.push({
      label:
        `Week ${i + 1}`,

      description:
        `${start.toFormat(
          'LLL d'
        )} - ${end.toFormat(
          'LLL d, yyyy'
        )}`,

      value:
        String(i),
    });
  }

  return {
    content: [
      '🗓️ **Choose Which Week**',

      '',

      app.mode ===
        'real'
        ? 'Week 1 starts at least **7 days from today**.'
        : '🧪 Test Mode: Week 1 starts **today**.',
    ].join('\n'),

    components: [
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              `pick_week:${app.id}`
            )
            .setPlaceholder(
              'Choose which week'
            )
            .addOptions(
              options
            )
        ),
    ],
  };
}

function buildDatePicker(
  app,
  weekIndex
) {
  const start =
    weekStartFor(
      app,
      weekIndex
    );

  const options = [];

  for (
    let i = 0;
    i < 7;
    i++
  ) {
    const date =
      start.plus({
        days: i,
      });

    options.push({
      label:
        date.toFormat(
          'cccc, LLLL d'
        ),

      description:
        date.toFormat(
          'yyyy'
        ),

      value:
        date.toISODate(),
    });
  }

  return {
    content:
      `📅 **Choose Interview Day — Week ${Number(
        weekIndex
      ) + 1}**`,

    components: [
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              `pick_date:${app.id}`
            )
            .setPlaceholder(
              'Choose a day'
            )
            .addOptions(
              options
            )
        ),

      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `back_weeks:${app.id}`
            )
            .setLabel(
              'Change Week'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
        ),
    ],
  };
}

function buildTimePicker(
  app,
  dateISO
) {
  return {
    content:
      `📅 **${DateTime.fromISO(
        dateISO
      ).toFormat(
        'cccc, LLLL d, yyyy'
      )}**\n\n🕐 **Choose Interview Time**`,

    components: [
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              `pick_time:${app.id}:${dateISO}`
            )
            .setPlaceholder(
              'Choose a time'
            )
            .addOptions(
              TIME_OPTIONS.map(
                (
                  [
                    value,
                    label,
                  ]
                ) => ({
                  value,
                  label,
                })
              )
            )
        ),
    ],
  };
}

function buildTimezonePicker(
  app,
  dateISO,
  timeValue
) {
  return {
    content:
      '🌎 **Choose Your Time Zone**',

    components: [
      new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(
              `pick_timezone:${app.id}:${dateISO}:${timeValue}`
            )
            .setPlaceholder(
              'Choose your timezone'
            )
            .addOptions(
              TIMEZONE_OPTIONS
            )
        ),
    ],
  };
}

function selectedDateTimeToUnix(
  dateISO,
  timeValue,
  timezoneValue
) {
  const zone =
    TIMEZONE_ZONES[
      timezoneValue
    ];

  if (!zone) {
    return null;
  }

  const dt =
    DateTime.fromISO(
      `${dateISO}T${timeValue}:00`,
      {
        zone,
      }
    );

  return dt.isValid
    ? Math.floor(
        dt.toSeconds()
      )
    : null;
}

// =====================================================
// MANAGEMENT PANEL
// =====================================================

function managementEmbed() {
  const mode =
    getSetting(
      'system_mode',
      'closed'
    );

  const state =
    mode ===
      'test'
      ? '🧪 Testing Mode'
      : mode ===
          'public'
        ? '🟢 Public Applications Open'
        : '🔴 Applications Closed';

  return new EmbedBuilder()
    .setTitle(
      '🛡️ Crafted SMP Staff Application System'
    )
    .setDescription([
      `**Current Status:** ${state}`,

      '',

      `Submitted applications: <#${SUBMITTED_APPLICATIONS_CHANNEL_ID}>`,

      `Permanent results + notes: <#${INTERVIEW_RESULTS_CHANNEL_ID}>`,

      '',

      '**Start Interview and End Interview only appear inside the private scoring channel.**',
    ].join('\n'));
}

function managementRows() {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'manage_test_mode'
          )
          .setLabel(
            'Testing Mode'
          )
          .setEmoji(
            '🧪'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            'manage_test_applicant'
          )
          .setLabel(
            'Choose Test Applicant'
          )
          .setEmoji(
            '👤'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'manage_public_open'
          )
          .setLabel(
            'Enable Public Applications'
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            'manage_close'
          )
          .setLabel(
            'Close Applications'
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            'manage_reset_test'
          )
          .setLabel(
            'Reset Test'
          )
          .setStyle(
            ButtonStyle.Danger
          )
      ),
  ];
}

async function ensureManagementPanel() {
  const channel =
    await fetchTextChannel(
      APPLICATION_CONTROL_CHANNEL_ID
    );

  if (
    !channel
  ) {
    throw new Error(
      'Application control channel not found.'
    );
  }

  const messages =
    await channel.messages
      .fetch({
        limit: 50,
      })
      .catch(
        () =>
          null
      );

  const existing =
    messages?.find(
      message =>
        message.author.id ===
          client.user.id &&
        message.components.some(
          row =>
            row.components.some(
              component =>
                component.customId ===
                'manage_test_mode'
            )
        )
    );

  if (
    existing
  ) {
    return existing.edit({
      embeds: [
        managementEmbed(),
      ],

      components:
        managementRows(),
    });
  }

  return channel.send({
    embeds: [
      managementEmbed(),
    ],

    components:
      managementRows(),
  });
}

// =====================================================
// APPLICATION PANEL
// =====================================================

function applicationPanelEmbed(
  isTest = false
) {
  return new EmbedBuilder()
    .setTitle(
      isTest
        ? '🧪 Staff Application — TEST MODE'
        : '🛡️ Crafted SMP Staff Applications'
    )
    .setDescription([
      isTest
        ? '**TEST ONLY**'
        : '**Applications are open.**',

      '',

      '1. Enter your age and moderation experience.',

      '2. Choose which week.',

      '3. Choose the exact day.',

      '4. Choose the time.',

      '5. Choose your timezone.',
    ].join('\n'));
}

function applicationButton(
  isTest = false
) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          isTest
            ? 'apply_test'
            : 'apply_public'
        )
        .setLabel(
          isTest
            ? 'Submit Test Application'
            : 'Apply for Staff'
        )
        .setStyle(
          ButtonStyle.Primary
        )
    );
}

function applicationModal(
  mode
) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `application_modal:${mode}`
      )
      .setTitle(
        mode ===
          'test'
          ? 'TEST Staff Application'
          : 'Staff Application'
      );

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId(
            'age'
          )
          .setLabel(
            'What is your age?'
          )
          .setStyle(
            TextInputStyle.Short
          )
          .setRequired(
            true
          )
          .setMaxLength(
            20
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId(
            'experience'
          )
          .setLabel(
            'Positive moderation experience'
          )
          .setStyle(
            TextInputStyle.Paragraph
          )
          .setRequired(
            true
          )
          .setMaxLength(
            1000
          )
      )
  );

  return modal;
}

async function createPublicApplicationChannel(
  guild
) {
  const oldId =
    getSetting(
      'public_application_channel_id'
    );

  if (
    oldId
  ) {
    const existing =
      await guild.channels
        .fetch(
          oldId
        )
        .catch(
          () =>
            null
        );

    if (
      existing
    ) {
      return existing;
    }
  }

  const channel =
    await guild.channels.create({
      name:
        'staff-applications',

      type:
        ChannelType.GuildText,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites: [
        {
          id:
            guild.roles.everyone.id,

          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],

          deny: [
            PermissionFlagsBits.SendMessages,
          ],
        },
      ],
    });

  await channel.send({
    embeds: [
      applicationPanelEmbed(
        false
      ),
    ],

    components: [
      applicationButton(
        false
      ),
    ],
  });

  setSetting(
    'public_application_channel_id',
    channel.id
  );

  return channel;
}

async function deletePublicApplicationChannel(
  guild
) {
  const id =
    getSetting(
      'public_application_channel_id'
    );

  if (
    !id
  ) {
    return;
  }

  const channel =
    await guild.channels
      .fetch(
        id
      )
      .catch(
        () =>
          null
      );

  if (
    channel
  ) {
    await channel
      .delete()
      .catch(
        () =>
          null
      );
  }

  setSetting(
    'public_application_channel_id',
    ''
  );
}

async function createTestApplicantChannel(
  guild,
  userId
) {
  const member =
    await guild.members
      .fetch(
        userId
      )
      .catch(
        () =>
          null
      );

  if (
    !member
  ) {
    throw new Error(
      'Test applicant not found.'
    );
  }

  const oldId =
    getSetting(
      'test_application_channel_id'
    );

  if (
    oldId
  ) {
    const old =
      await guild.channels
        .fetch(
          oldId
        )
        .catch(
          () =>
            null
        );

    if (
      old
    ) {
      await old
        .delete()
        .catch(
          () =>
            null
        );
    }
  }

  const channel =
    await guild.channels.create({
      name:
        `test-application-${slugify(
          member.user.username
        )}`,

      type:
        ChannelType.GuildText,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites:
        staffPermissions(
          guild,
          userId
        ),
    });

  await channel.send({
    content:
      `<@${userId}>`,

    embeds: [
      applicationPanelEmbed(
        true
      ),
    ],

    components: [
      applicationButton(
        true
      ),
    ],
  });

  setSetting(
    'test_application_channel_id',
    channel.id
  );

  return channel;
}

// =====================================================
// SUBMITTED APPLICATION CARD
// =====================================================

async function postSubmittedApplication(
  appId
) {
  const app =
    getApplication(
      appId
    );

  if (
    !app
  ) {
    return;
  }

  const channel =
    await fetchTextChannel(
      SUBMITTED_APPLICATIONS_CHANNEL_ID
    );

  if (
    !channel
  ) {
    throw new Error(
      'Submitted applications channel not found.'
    );
  }

  const approvals =
    getApprovals(
      app.id
    );

  const interviewers =
    getInterviewers(
      app.id
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        app.mode ===
          'test'
          ? '🧪 TEST APPLICATION'
          : '🛡️ Staff Application'
      )
      .addFields(
        {
          name:
            'Applicant',

          value:
            `<@${app.user_id}>`,

          inline:
            true,
        },

        {
          name:
            'Age',

          value:
            app.age,

          inline:
            true,
        },

        {
          name:
            'Status',

          value:
            statusLabel(
              app.status
            ),

          inline:
            true,
        },

        {
          name:
            'Interview',

          value:
            app.interview_ts
              ? `<t:${app.interview_ts}:F>\n<t:${app.interview_ts}:R>`
              : 'Not selected',

          inline:
            false,
        },

        {
          name:
            'Experience',

          value:
            app.experience.slice(
              0,
              1024
            ),

          inline:
            false,
        },

        {
          name:
            'Confirmations',

          value:
            approvals.length
              ? approvals
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join(
                    '\n'
                  )
              : 'None',

          inline:
            true,
        },

        {
          name:
            'Interviewers',

          value:
            interviewers.length
              ? interviewers
                  .map(
                    id =>
                      `<@${id}>`
                  )
                  .join(
                    '\n'
                  )
              : 'None',

          inline:
            true,
        }
      )
      .setFooter({
        text:
          `Application #${app.id}`,
      });

  const components = [];

  if (
    ![
      'completed',
      'accepted',
      'rejected',
      'cancelled',
    ].includes(
      app.status
    )
  ) {
    components.push(
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `approve:${app.id}`
            )
            .setLabel(
              'Confirm Interview'
            )
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `reschedule:${app.id}`
            )
            .setLabel(
              'Choose Different Time'
            )
            .setStyle(
              ButtonStyle.Secondary
            ),

          new ButtonBuilder()
            .setCustomId(
              `cant_make:${app.id}`
            )
            .setLabel(
              "Can't Make It"
            )
            .setStyle(
              ButtonStyle.Danger
            )
        )
    );
  }

  let message = null;

  if (
    app.submission_message_id
  ) {
    message =
      await channel.messages
        .fetch(
          app.submission_message_id
        )
        .catch(
          () =>
            null
        );
  }

  if (
    message
  ) {
    await message.edit({
      embeds: [
        embed,
      ],

      components,
    });
  } else {
    message =
      await channel.send({
        embeds: [
          embed,
        ],

        components,
      });

    db.prepare(`
      UPDATE applications
      SET submission_message_id = ?
      WHERE id = ?
    `).run(
      message.id,
      app.id
    );
  }
}

// =====================================================
// APPROVAL CHECK
// =====================================================

async function getApprovalStatus(
  appId,
  guild
) {
  let seniorCount = 0;
  let ownerOverride = false;

  for (
    const id
    of getApprovals(
      appId
    )
  ) {
    const member =
      await guild.members
        .fetch(
          id
        )
        .catch(
          () =>
            null
        );

    if (
      !member
    ) {
      continue;
    }

    if (
      isOwnerOrCoOwner(
        member
      )
    ) {
      ownerOverride = true;
    } else if (
      isSenior(
        member
      )
    ) {
      seniorCount++;
    }
  }

  return {
    seniorCount,
    ownerOverride,

    confirmed:
      ownerOverride ||
      seniorCount >=
        2,
  };
}

// =====================================================
// INTERVIEW CHANNELS
// =====================================================

async function ensureInterviewTextChannel(
  app,
  guild
) {
  if (
    app.interview_text_channel_id
  ) {
    const existing =
      await guild.channels
        .fetch(
          app.interview_text_channel_id
        )
        .catch(
          () =>
            null
        );

    if (
      existing
    ) {
      return existing;
    }
  }

  const member =
    await guild.members
      .fetch(
        app.user_id
      )
      .catch(
        () =>
          null
      );

  const channel =
    await guild.channels.create({
      name:
        `interview-${slugify(
          member?.user?.username
        )}`,

      type:
        ChannelType.GuildText,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites:
        staffPermissions(
          guild,
          app.user_id
        ),
    });

  db.prepare(`
    UPDATE applications
    SET interview_text_channel_id = ?
    WHERE id = ?
  `).run(
    channel.id,
    app.id
  );

  return channel;
}

async function ensureScoringChannel(
  app,
  guild
) {
  if (
    app.scoring_channel_id
  ) {
    const existing =
      await guild.channels
        .fetch(
          app.scoring_channel_id
        )
        .catch(
          () =>
            null
        );

    if (
      existing
    ) {
      return existing;
    }
  }

  const member =
    await guild.members
      .fetch(
        app.user_id
      )
      .catch(
        () =>
          null
      );

  const channel =
    await guild.channels.create({
      name:
        `scoring-${slugify(
          member?.user?.username
        )}`,

      type:
        ChannelType.GuildText,

      parent:
        SCORING_CATEGORY_ID,

      permissionOverwrites:
        staffPermissions(
          guild
        ),
    });

  db.prepare(`
    UPDATE applications
    SET scoring_channel_id = ?
    WHERE id = ?
  `).run(
    channel.id,
    app.id
  );

  return channel;
}

function scoringHomeRows(
  appId
) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `owner_start:${appId}`
          )
          .setLabel(
            'Start Interview'
          )
          .setEmoji(
            '🎙️'
          )
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `owner_end:${appId}`
          )
          .setLabel(
            'End Interview'
          )
          .setEmoji(
            '🏁'
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            `add_senior:${appId}`
          )
          .setLabel(
            'Add Senior Staff'
          )
          .setEmoji(
            '➕'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `open_board:${appId}`
          )
          .setLabel(
            'Open Interview Board'
          )
          .setEmoji(
            '📝'
          )
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `view_progress:${appId}`
          )
          .setLabel(
            'View My Scores'
          )
          .setEmoji(
            '📊'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `cant_make:${appId}`
          )
          .setLabel(
            'Cancel Interviewing'
          )
          .setEmoji(
            '❌'
          )
          .setStyle(
            ButtonStyle.Danger
          )
      ),
  ];
}

async function postScoringHome(
  app,
  guild
) {
  const channel =
    await ensureScoringChannel(
      app,
      guild
    );

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          '🛡️ Trial Moderator Promotion Board'
        )
        .setDescription([
          OPENING_BRIEF,

          '',

          '### Scoring Rules',

          '• Pick exactly **3 questions** in each category.',

          '• The moment you select the 3 questions, the screen immediately changes to the grading screen.',

          '• All 3 selected questions appear together.',

          '• Grade the category once as **0/3, 1/3, 2/3, or 3/3**.',

          '• Add one set of notes for the category.',

          `• Maximum score per interviewer: **${MAX_SCORE_PER_INTERVIEWER}/${MAX_SCORE_PER_INTERVIEWER}**.`,

          '',

          '**The applicant cannot see this channel.**',
        ].join('\n')),
    ],

    components:
      scoringHomeRows(
        app.id
      ),
  });

  return channel;
}

async function confirmInterview(
  appId,
  guild
) {
  let app =
    getApplication(
      appId
    );

  if (
    !app
  ) {
    return;
  }

  const textChannel =
    await ensureInterviewTextChannel(
      app,
      guild
    );

  app =
    getApplication(
      app.id
    );

  await postScoringHome(
    app,
    guild
  );

  db.prepare(`
    UPDATE applications
    SET status = 'confirmed'
    WHERE id = ?
  `).run(
    app.id
  );

  app =
    getApplication(
      app.id
    );

  await textChannel.send({
    content:
      `<@${app.user_id}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          '✅ Interview Confirmed'
        )
        .setDescription(
          `**Interview:** <t:${app.interview_ts}:F>\n\nWait for the Owner or Co-Owner to start the interview.`
        ),
    ],
  });

  const notificationChannel =
    await fetchTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (
    notificationChannel
  ) {
    await notificationChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            '✅ Interview Confirmed'
          )
          .setDescription(
            `Applicant: <@${app.user_id}>\nInterview: <t:${app.interview_ts}:F>`
          ),
      ],
    });
  }

  await postSubmittedApplication(
    app.id
  );
}

// =====================================================
// VOICE CHANNEL
// =====================================================

async function createVoiceChannel(
  app,
  guild
) {
  if (
    app.interview_voice_channel_id
  ) {
    const existing =
      await guild.channels
        .fetch(
          app.interview_voice_channel_id
        )
        .catch(
          () =>
            null
        );

    if (
      existing
    ) {
      return existing;
    }
  }

  const member =
    await guild.members
      .fetch(
        app.user_id
      )
      .catch(
        () =>
          null
      );

  const overwrites = [
    {
      id:
        guild.roles.everyone.id,

      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
      ],
    },

    {
      id:
        app.user_id,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    },

    {
      id:
        OWNER_ROLE_ID,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    },

    {
      id:
        CO_OWNER_ROLE_ID,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    },
  ];

  for (
    const id
    of getInterviewers(
      app.id
    )
  ) {
    overwrites.push({
      id,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    });
  }

  const voice =
    await guild.channels.create({
      name:
        `Interview - ${member?.user?.username || 'Applicant'}`,

      type:
        ChannelType.GuildVoice,

      parent:
        MAIN_CATEGORY_ID,

      permissionOverwrites:
        overwrites,
    });

  db.prepare(`
    UPDATE applications
    SET interview_voice_channel_id = ?
    WHERE id = ?
  `).run(
    voice.id,
    app.id
  );

  return voice;
}

async function startInterview(
  appId,
  guild
) {
  let app =
    getApplication(
      appId
    );

  if (
    !app
  ) {
    throw new Error(
      'Application not found.'
    );
  }

  const approval =
    await getApprovalStatus(
      app.id,
      guild
    );

  if (
    !approval.confirmed
  ) {
    throw new Error(
      'Needs 2 Senior Staff confirmations or 1 Owner/Co-Owner confirmation.'
    );
  }

  const voice =
    await createVoiceChannel(
      app,
      guild
    );

  db.prepare(`
    UPDATE applications
    SET status = 'in_progress'
    WHERE id = ?
  `).run(
    app.id
  );

  app =
    getApplication(
      app.id
    );

  const interviewChannel =
    await fetchTextChannel(
      app.interview_text_channel_id
    );

  if (
    interviewChannel
  ) {
    await interviewChannel.send({
      content:
        `<@${app.user_id}>`,

      embeds: [
        new EmbedBuilder()
          .setTitle(
            '🎙️ Interview Started'
          )
          .setDescription(
            `Join voice: ${voice}`
          ),
      ],
    });
  }

  const notificationChannel =
    await fetchTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (
    notificationChannel
  ) {
    await notificationChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            '🎙️ Interview Started'
          )
          .setDescription(
            `Applicant: <@${app.user_id}>\nVoice: ${voice}`
          ),
      ],
    });
  }

  await postSubmittedApplication(
    app.id
  );

  return voice;
}

// =====================================================
// INTERVIEW SCORING DATA
// =====================================================

function getSession(
  appId,
  staffId
) {
  let row =
    db.prepare(`
      SELECT *
      FROM interview_sessions
      WHERE app_id = ?
        AND staff_id = ?
    `)
      .get(
        appId,
        staffId
      );

  if (
    !row
  ) {
    db.prepare(`
      INSERT INTO interview_sessions(
        app_id,
        staff_id,
        current_category,
        finished
      )
      VALUES(
        ?,
        ?,
        -1,
        0
      )
    `).run(
      appId,
      staffId
    );

    row = {
      app_id:
        appId,

      staff_id:
        staffId,

      current_category:
        -1,

      finished:
        0,
    };
  }

  return row;
}

function getCategoryProgress(
  appId,
  staffId,
  categoryIndex
) {
  let row =
    db.prepare(`
      SELECT *
      FROM category_progress
      WHERE app_id = ?
        AND staff_id = ?
        AND category_index = ?
    `)
      .get(
        appId,
        staffId,
        categoryIndex
      );

  if (
    !row
  ) {
    db.prepare(`
      INSERT INTO category_progress(
        app_id,
        staff_id,
        category_index,
        selected_questions,
        score,
        notes
      )
      VALUES(
        ?,
        ?,
        ?,
        '[]',
        NULL,
        ''
      )
    `).run(
      appId,
      staffId,
      categoryIndex
    );

    row = {
      selected_questions:
        '[]',

      score:
        null,

      notes:
        '',
    };
  }

  return row;
}

function selectedQuestions(
  progress
) {
  try {
    return JSON.parse(
      progress.selected_questions ||
      '[]'
    );
  } catch {
    return [];
  }
}

function openingBriefEmbed(
  app
) {
  return new EmbedBuilder()
    .setTitle(
      '🛡️ Interview Opening Brief'
    )
    .setDescription(
      `${OPENING_BRIEF}\n\nClick **Next Category** to begin.`
    );
}

function closingBriefEmbed(
  app
) {
  return new EmbedBuilder()
    .setTitle(
      '🏁 Interview Closing Brief'
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,

      '',

      CLOSING_BRIEF,

      '',

      'Review your scores, then click **Finish My Scoring**.',

      '',

      '**Owner/Co-Owner:** after everyone finishes, click **End Interview**. The bot saves the results first, then deletes the interview text channel, voice channel, and scoring channel itself.',
    ].join('\n'));
}

function categorySelectionEmbed(
  app,
  staffId,
  categoryIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const progress =
    getCategoryProgress(
      app.id,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestions(
      progress
    );

  const allQuestions =
    category.questions
      .map(
        question =>
          `${selected.includes(
            question.number
          )
            ? '✅'
            : '⬜'
          } **${question.number}.** ${question.text}`
      )
      .join(
        '\n\n'
      );

  return new EmbedBuilder()
    .setTitle(
      `${category.name}${
        category.code
          ? ` — ${category.code}`
          : ''
      }`
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,

      '',

      '## Pick exactly 3 questions',

      '',

      allQuestions,

      '',

      `**Selected:** ${selected.length}/3`,

      `**Current Grade:** ${
        Number.isInteger(
          progress.score
        )
          ? `${progress.score}/3`
          : 'Not graded yet'
      }`,

      '',

      '**Notes:**',

      progress.notes ||
        '_No notes yet._',
    ].join('\n'));
}

function categorySelectionRows(
  app,
  staffId,
  categoryIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const progress =
    getCategoryProgress(
      app.id,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestions(
      progress
    );

  return [
    new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            `pick3:${app.id}:${categoryIndex}`
          )
          .setPlaceholder(
            'Choose exactly 3 questions'
          )
          .setMinValues(
            3
          )
          .setMaxValues(
            3
          )
          .addOptions(
            category.questions.map(
              question => ({
                label:
                  `Question ${question.number}`,

                description:
                  question.text
                    .replace(
                      /\n/g,
                      ' '
                    )
                    .slice(
                      0,
                      90
                    ),

                value:
                  String(
                    question.number
                  ),

                default:
                  selected.includes(
                    question.number
                  ),
              })
            )
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `cat_prev:${app.id}`
          )
          .setLabel(
            'Previous Category'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `cat_next:${app.id}`
          )
          .setLabel(
            categoryIndex ===
              CATEGORY_COUNT -
                1
              ? 'Closing Brief'
              : 'Next Category'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),
  ];
}

function selectedThreeEmbed(
  app,
  staffId,
  categoryIndex
) {
  const category =
    QUESTION_CATEGORIES[
      categoryIndex
    ];

  const progress =
    getCategoryProgress(
      app.id,
      staffId,
      categoryIndex
    );

  const selected =
    selectedQuestions(
      progress
    );

  const selectedText =
    selected
      .map(
        (
          number,
          index
        ) => {
          const question =
            category.questions.find(
              item =>
                item.number ===
                number
            );

          return [
            `### ${index + 1}. Question ${question?.number}`,

            question?.text ||
              '',
          ].join('\n');
        }
      )
      .join(
        '\n\n'
      );

  return new EmbedBuilder()
    .setTitle(
      `${category.name} — Selected 3 Questions`
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,

      '',

      selectedText,

      '',

      '---',

      '',

      `## Category Grade: ${
        Number.isInteger(
          progress.score
        )
          ? `${progress.score}/3`
          : 'Not graded yet'
      }`,

      '',

      '**Category Notes:**',

      progress.notes ||
        '_No notes yet._',
    ].join('\n'));
}

function selectedThreeRows(
  app,
  categoryIndex
) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `grade_cat:${app.id}:${categoryIndex}:0`
          )
          .setLabel(
            '0/3'
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            `grade_cat:${app.id}:${categoryIndex}:1`
          )
          .setLabel(
            '1/3'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `grade_cat:${app.id}:${categoryIndex}:2`
          )
          .setLabel(
            '2/3'
          )
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `grade_cat:${app.id}:${categoryIndex}:3`
          )
          .setLabel(
            '3/3'
          )
          .setStyle(
            ButtonStyle.Success
          )
      ),

    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `category_notes:${app.id}:${categoryIndex}`
          )
          .setLabel(
            'Add / Edit Notes'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `back_category:${app.id}:${categoryIndex}`
          )
          .setLabel(
            'Change Selected Questions'
          )
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            `cat_next:${app.id}`
          )
          .setLabel(
            categoryIndex ===
              CATEGORY_COUNT -
                1
              ? 'Closing Brief'
              : 'Next Category'
          )
          .setStyle(
            ButtonStyle.Primary
          )
      ),
  ];
}

function notesModal(
  appId,
  categoryIndex,
  current = ''
) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `notes_modal:${appId}:${categoryIndex}`
      )
      .setTitle(
        'Category Notes'
      );

  const input =
    new TextInputBuilder()
      .setCustomId(
        'notes'
      )
      .setLabel(
        'Overall notes for these 3 questions'
      )
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(
        false
      )
      .setMaxLength(
        1500
      );

  if (
    current
  ) {
    input.setValue(
      current.slice(
        0,
        1500
      )
    );
  }

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        input
      )
  );

  return modal;
}

function scoreProgressEmbed(
  app,
  staffId
) {
  let total = 0;
  const lines = [];

  for (
    let i = 0;
    i < CATEGORY_COUNT;
    i++
  ) {
    const progress =
      getCategoryProgress(
        app.id,
        staffId,
        i
      );

    if (
      Number.isInteger(
        progress.score
      )
    ) {
      total +=
        progress.score;
    }

    lines.push(
      `**${QUESTION_CATEGORIES[i].name}: ${
        Number.isInteger(
          progress.score
        )
          ? `${progress.score}/3`
          : 'Not graded'
      }**`
    );
  }

  return new EmbedBuilder()
    .setTitle(
      '📊 My Score Progress'
    )
    .setDescription([
      ...lines,

      '',

      `## TOTAL: ${total}/${MAX_SCORE_PER_INTERVIEWER}`,
    ].join('\n'));
}

function allInterviewersFinished(
  appId
) {
  const interviewers =
    getInterviewers(
      appId
    );

  if (
    !interviewers.length
  ) {
    return false;
  }

  return interviewers.every(
    staffId =>
      db.prepare(`
        SELECT finished
        FROM interview_sessions
        WHERE app_id = ?
          AND staff_id = ?
      `)
        .get(
          appId,
          staffId
        )?.finished ===
        1
  );
}

// =====================================================
// RESULTS + CLEANUP
// =====================================================

async function postResults(
  appId
) {
  const app =
    getApplication(
      appId
    );

  const channel =
    await fetchTextChannel(
      INTERVIEW_RESULTS_CHANNEL_ID
    );

  if (
    !app ||
    !channel
  ) {
    throw new Error(
      'Results channel not found.'
    );
  }

  let combinedTotal = 0;
  let combinedMax = 0;

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          app.mode ===
            'test'
            ? '🧪 TEST Interview Results'
            : '📊 Staff Interview Results'
        )
        .setDescription([
          `Applicant: <@${app.user_id}>`,

          `Application: #${app.id}`,

          '',

          '**Applicant does not see these scores or notes.**',
        ].join('\n')),
    ],
  });

  for (
    const staffId
    of getInterviewers(
      app.id
    )
  ) {
    let total = 0;

    const fields = [];

    for (
      let i = 0;
      i < CATEGORY_COUNT;
      i++
    ) {
      const category =
        QUESTION_CATEGORIES[
          i
        ];

      const progress =
        getCategoryProgress(
          app.id,
          staffId,
          i
        );

      const selected =
        selectedQuestions(
          progress
        );

      const score =
        Number.isInteger(
          progress.score
        )
          ? progress.score
          : 0;

      total +=
        score;

      const selectedText =
        selected
          .map(
            number => {
              const question =
                category.questions.find(
                  item =>
                    item.number ===
                    number
                );

              return `Q${number}: ${question?.text || ''}`;
            }
          )
          .join(
            '\n'
          );

      fields.push({
        name:
          `${category.name} — ${score}/3`,

        value:
          [
            selectedText ||
              'No questions selected',

            '',

            `**Notes:** ${
              progress.notes ||
              'None'
            }`,
          ]
            .join(
              '\n'
            )
            .slice(
              0,
              1024
            ),
      });
    }

    combinedTotal +=
      total;

    combinedMax +=
      MAX_SCORE_PER_INTERVIEWER;

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            '📝 Interviewer Score'
          )
          .setDescription([
            `Applicant: <@${app.user_id}>`,

            `Interviewer: <@${staffId}>`,

            '',

            `## TOTAL: ${total}/${MAX_SCORE_PER_INTERVIEWER}`,
          ].join('\n'))
          .addFields(
            fields
          ),
      ],
    });
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          '📌 Combined Interview Score'
        )
        .setDescription(
          `Applicant: <@${app.user_id}>\n\n## ${combinedTotal}/${combinedMax}`
        ),
    ],

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `final_accept:${app.id}`
            )
            .setLabel(
              'Accept'
            )
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `final_reject:${app.id}`
            )
            .setLabel(
              'Reject'
            )
            .setStyle(
              ButtonStyle.Danger
            ),

          new ButtonBuilder()
            .setCustomId(
              `final_review:${app.id}`
            )
            .setLabel(
              'Further Review'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
        ),
    ],
  });
}

async function cleanupInterview(
  app,
  guild
) {
  const ids = [
    app.interview_voice_channel_id,
    app.interview_text_channel_id,
    app.scoring_channel_id,
  ];

  for (
    const id
    of ids
  ) {
    if (
      !id
    ) {
      continue;
    }

    const channel =
      await guild.channels
        .fetch(
          id
        )
        .catch(
          () =>
            null
        );

    if (
      channel
    ) {
      await channel
        .delete(
          `Interview ${app.id} ended`
        )
        .catch(
          () =>
            null
        );
    }
  }

  db.prepare(`
    UPDATE applications
    SET
      interview_voice_channel_id = NULL,
      interview_text_channel_id = NULL,
      scoring_channel_id = NULL
    WHERE id = ?
  `).run(
    app.id
  );
}

async function endInterview(
  appId,
  guild
) {
  let app =
    getApplication(
      appId
    );

  if (
    !app
  ) {
    throw new Error(
      'Application not found.'
    );
  }

  if (
    !allInterviewersFinished(
      app.id
    )
  ) {
    throw new Error(
      'Every participating interviewer must finish scoring first.'
    );
  }

  // SAVE RESULTS + NOTES FIRST
  await postResults(
    app.id
  );

  db.prepare(`
    UPDATE applications
    SET
      status = 'completed',
      completed_at = ?
    WHERE id = ?
  `).run(
    Date.now(),
    app.id
  );

  await postSubmittedApplication(
    app.id
  );

  app =
    getApplication(
      app.id
    );

  // DELETE ALL TEMPORARY CHANNELS
  await cleanupInterview(
    app,
    guild
  );
}

// =====================================================
// RESET TEST
// =====================================================

async function resetTestData(
  guild
) {
  const apps =
    db.prepare(`
      SELECT *
      FROM applications
      WHERE mode = 'test'
    `)
      .all();

  for (
    const app
    of apps
  ) {
    await cleanupInterview(
      app,
      guild
    );

    db.prepare(
      'DELETE FROM approvals WHERE app_id = ?'
    ).run(
      app.id
    );

    db.prepare(
      'DELETE FROM interviewers WHERE app_id = ?'
    ).run(
      app.id
    );

    db.prepare(
      'DELETE FROM category_progress WHERE app_id = ?'
    ).run(
      app.id
    );

    db.prepare(
      'DELETE FROM interview_sessions WHERE app_id = ?'
    ).run(
      app.id
    );

    db.prepare(
      'DELETE FROM applications WHERE id = ?'
    ).run(
      app.id
    );
  }

  const id =
    getSetting(
      'test_application_channel_id'
    );

  if (
    id
  ) {
    const channel =
      await guild.channels
        .fetch(
          id
        )
        .catch(
          () =>
            null
        );

    if (
      channel
    ) {
      await channel
        .delete()
        .catch(
          () =>
            null
        );
    }
  }

  setSetting(
    'test_application_channel_id',
    ''
  );

  setSetting(
    'system_mode',
    'closed'
  );
}

// =====================================================
// READY
// =====================================================

client.once(
  Events.ClientReady,

  async readyClient => {
    console.log(
      `✅ Logged in as ${readyClient.user.tag}`
    );

    try {
      await ensureManagementPanel();
    } catch (
      error
    ) {
      console.error(
        '❌ Startup error:',
        error
      );
    }
  }
);

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
  Events.InteractionCreate,

  async interaction => {
    try {
      const guild =
        interaction.guild ||
        await client.guilds.fetch(
          GUILD_ID
        );

      const member =
        interaction.member ||
        await guild.members
          .fetch(
            interaction.user.id
          )
          .catch(
            () =>
              null
          );

      // ---------------- MANAGEMENT ----------------

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_test_mode'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        await deletePublicApplicationChannel(
          guild
        );

        setSetting(
          'system_mode',
          'test'
        );

        await ensureManagementPanel();

        return safeEphemeral(
          interaction,
          '🧪 Testing Mode enabled.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_test_applicant'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        if (
          getSetting(
            'system_mode'
          ) !==
          'test'
        ) {
          return safeEphemeral(
            interaction,
            'Enable Testing Mode first.'
          );
        }

        return interaction.reply({
          content:
            'Choose test applicant:',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new UserSelectMenuBuilder()
                  .setCustomId(
                    'select_test_applicant'
                  )
                  .setMinValues(
                    1
                  )
                  .setMaxValues(
                    1
                  )
                  .setPlaceholder(
                    'Choose test applicant'
                  )
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isUserSelectMenu() &&
        interaction.customId ===
          'select_test_applicant'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const channel =
          await createTestApplicantChannel(
            guild,
            interaction.values[0]
          );

        return interaction.update({
          content:
            `✅ Test applicant selected: ${channel}`,

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_public_open'
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const channel =
          await createPublicApplicationChannel(
            guild
          );

        setSetting(
          'system_mode',
          'public'
        );

        await ensureManagementPanel();

        return safeEphemeral(
          interaction,
          `✅ Applications open: ${channel}`
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_close'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        await deletePublicApplicationChannel(
          guild
        );

        setSetting(
          'system_mode',
          'closed'
        );

        await ensureManagementPanel();

        return safeEphemeral(
          interaction,
          '🔴 Applications closed.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId ===
          'manage_reset_test'
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        await resetTestData(
          guild
        );

        await ensureManagementPanel();

        return interaction.editReply(
          '✅ Test reset.'
        );
      }

      // ---------------- APPLY ----------------

      if (
        interaction.isButton() &&
        [
          'apply_test',
          'apply_public',
        ].includes(
          interaction.customId
        )
      ) {
        const mode =
          interaction.customId ===
            'apply_test'
            ? 'test'
            : 'real';

        if (
          mode ===
            'test' &&
          getSetting(
            'system_mode'
          ) !==
            'test'
        ) {
          return safeEphemeral(
            interaction,
            'Testing Mode is not enabled.'
          );
        }

        if (
          mode ===
            'real' &&
          getSetting(
            'system_mode'
          ) !==
            'public'
        ) {
          return safeEphemeral(
            interaction,
            'Applications are closed.'
          );
        }

        return interaction.showModal(
          applicationModal(
            mode
          )
        );
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'application_modal:'
        )
      ) {
        const mode =
          interaction.customId
            .split(
              ':'
            )[1];

        const age =
          interaction.fields
            .getTextInputValue(
              'age'
            )
            .trim();

        const experience =
          interaction.fields
            .getTextInputValue(
              'experience'
            )
            .trim();

        const result =
          db.prepare(`
            INSERT INTO applications(
              user_id,
              mode,
              age,
              experience,
              interview_ts,
              timezone,
              status,
              created_at
            )
            VALUES(
              ?,
              ?,
              ?,
              ?,
              0,
              'PENDING',
              'choosing_time',
              ?
            )
          `).run(
            interaction.user.id,
            mode,
            age,
            experience,
            Date.now()
          );

        const app =
          getApplication(
            result.lastInsertRowid
          );

        return interaction.reply({
          ...buildWeekPicker(
            app
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ---------------- WEEK / DATE / TIME ----------------

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_week:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return interaction.update(
          buildDatePicker(
            app,
            Number(
              interaction.values[0]
            )
          )
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_weeks:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return interaction.update(
          buildWeekPicker(
            app
          )
        );
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_date:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return interaction.update(
          buildTimePicker(
            app,
            interaction.values[0]
          )
        );
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_time:'
        )
      ) {
        const [
          ,
          appId,
          dateISO,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        return interaction.update(
          buildTimezonePicker(
            app,
            dateISO,
            interaction.values[0]
          )
        );
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_timezone:'
        )
      ) {
        const [
          ,
          appId,
          dateISO,
          timeValue,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This picker is not yours.'
          );
        }

        const timezone =
          interaction.values[0];

        const timestamp =
          selectedDateTimeToUnix(
            dateISO,
            timeValue,
            timezone
          );

        if (
          !timestamp
        ) {
          return safeEphemeral(
            interaction,
            '❌ Invalid date/time.'
          );
        }

        if (
          app.mode ===
            'real' &&
          timestamp <
            unixNow() +
            7 *
            86400
        ) {
          return safeEphemeral(
            interaction,
            '❌ Real interviews must be at least 7 days in advance.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET
            interview_ts = ?,
            timezone = ?,
            status = 'pending'
          WHERE id = ?
        `).run(
          timestamp,
          timezone,
          app.id
        );

        db.prepare(`
          DELETE FROM approvals
          WHERE app_id = ?
        `).run(
          app.id
        );

        db.prepare(`
          DELETE FROM interviewers
          WHERE app_id = ?
        `).run(
          app.id
        );

        await postSubmittedApplication(
          app.id
        );

        return interaction.update({
          content:
            `✅ Interview time selected: <t:${timestamp}:F>\n<t:${timestamp}:R>`,

          components: [],
        });
      }

      // ---------------- APPROVE ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'approve:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          INSERT OR IGNORE INTO approvals(
            app_id,
            staff_id,
            created_at
          )
          VALUES(
            ?,
            ?,
            ?
          )
        `).run(
          app.id,
          interaction.user.id,
          Date.now()
        );

        db.prepare(`
          INSERT OR IGNORE INTO interviewers(
            app_id,
            staff_id,
            added_by
          )
          VALUES(
            ?,
            ?,
            ?
          )
        `).run(
          app.id,
          interaction.user.id,
          interaction.user.id
        );

        const approval =
          await getApprovalStatus(
            app.id,
            guild
          );

        await postSubmittedApplication(
          app.id
        );

        if (
          approval.confirmed
        ) {
          await confirmInterview(
            app.id,
            guild
          );

          return safeEphemeral(
            interaction,
            '✅ Interview confirmed. Private interview + scoring channels created.'
          );
        }

        return safeEphemeral(
          interaction,
          `✅ Confirmation saved. ${approval.seniorCount}/2 Senior Staff.`
        );
      }

      // ---------------- RESCHEDULE ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'reschedule:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET status = 'needs_time'
          WHERE id = ?
        `).run(
          app.id
        );

        await postSubmittedApplication(
          app.id
        );

        const user =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(
              () =>
                null
            );

        if (
          user
        ) {
          await user.send({
            content:
              '📅 Staff needs you to choose a new interview week/date/time.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `app_reschedule:${app.id}`
                    )
                    .setLabel(
                      'Choose New Time'
                    )
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],
          }).catch(
            () =>
              null
          );
        }

        return safeEphemeral(
          interaction,
          '📅 Reschedule request sent.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'app_reschedule:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeEphemeral(
            interaction,
            '❌ Applicant only.'
          );
        }

        return interaction.reply({
          ...buildWeekPicker(
            app
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ---------------- ADD SENIOR STAFF ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'add_senior:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
          interaction.channelId !==
            app.scoring_channel_id
        ) {
          return safeEphemeral(
            interaction,
            '❌ This only works inside the scoring channel.'
          );
        }

        return interaction.reply({
          content:
            'Choose one or more Senior Staff:',

          components: [
            new ActionRowBuilder()
              .addComponents(
                new UserSelectMenuBuilder()
                  .setCustomId(
                    `select_senior:${app.id}`
                  )
                  .setPlaceholder(
                    'Choose Senior Staff'
                  )
                  .setMinValues(
                    1
                  )
                  .setMaxValues(
                    10
                  )
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isUserSelectMenu() &&
        interaction.customId.startsWith(
          'select_senior:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        const added = [];
        const rejected = [];

        for (
          const id
          of interaction.values
        ) {
          const selectedMember =
            await guild.members
              .fetch(
                id
              )
              .catch(
                () =>
                  null
              );

          if (
            !selectedMember ||
            !isSenior(
              selectedMember
            )
          ) {
            rejected.push(
              id
            );

            continue;
          }

          db.prepare(`
            INSERT OR IGNORE INTO interviewers(
              app_id,
              staff_id,
              added_by
            )
            VALUES(
              ?,
              ?,
              ?
            )
          `).run(
            app.id,
            id,
            interaction.user.id
          );

          added.push(
            id
          );
        }

        await postSubmittedApplication(
          app.id
        );

        return interaction.update({
          content: [
            added.length
              ? `✅ Added: ${added.map(
                  id =>
                    `<@${id}>`
                ).join(
                  ', '
                )}`
              : 'No staff added.',

            rejected.length
              ? `\n❌ Not Senior Staff: ${rejected.map(
                  id =>
                    `<@${id}>`
                ).join(
                  ', '
                )}`
              : '',
          ].join(''),

          components: [],
        });
      }

      // ---------------- CANCEL INTERVIEWER ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'cant_make:'
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          DELETE FROM approvals
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM interviewers
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM category_progress
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM interview_sessions
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        const approval =
          await getApprovalStatus(
            app.id,
            guild
          );

        if (
          !approval.confirmed &&
          [
            'confirmed',
            'in_progress',
          ].includes(
            app.status
          )
        ) {
          await cleanupInterview(
            app,
            guild
          );

          db.prepare(`
            UPDATE applications
            SET status = 'pending'
            WHERE id = ?
          `).run(
            app.id
          );
        }

        await postSubmittedApplication(
          app.id
        );

        return safeEphemeral(
          interaction,
          '✅ You were removed from the interview.'
        );
      }

      // ---------------- START INTERVIEW ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'owner_start:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
          interaction.channelId !==
            app.scoring_channel_id
        ) {
          return safeEphemeral(
            interaction,
            '❌ Start Interview only works in the scoring channel.'
          );
        }

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        try {
          const voice =
            await startInterview(
              app.id,
              guild
            );

          return interaction.editReply(
            `🎙️ Interview started: ${voice}`
          );
        } catch (
          error
        ) {
          return interaction.editReply(
            `❌ ${error.message}`
          );
        }
      }

      // ---------------- OPEN BOARD ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'open_board:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        const session =
          getSession(
            app.id,
            interaction.user.id
          );

        if (
          session.current_category ===
          -1
        ) {
          return interaction.reply({
            embeds: [
              openingBriefEmbed(
                app
              ),
            ],

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `cat_next:${app.id}`
                    )
                    .setLabel(
                      'Next Category'
                    )
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],

            flags:
              MessageFlags.Ephemeral,
          });
        }

        if (
          session.current_category >=
          CATEGORY_COUNT
        ) {
          const rows = [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `cat_prev:${app.id}`
                  )
                  .setLabel(
                    'Previous Category'
                  )
                  .setStyle(
                    ButtonStyle.Secondary
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `view_progress:${app.id}`
                  )
                  .setLabel(
                    'View My Scores'
                  )
                  .setStyle(
                    ButtonStyle.Secondary
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `finish_scoring:${app.id}`
                  )
                  .setLabel(
                    'Finish My Scoring'
                  )
                  .setStyle(
                    ButtonStyle.Success
                  )
              ),
          ];

          if (
            isOwnerOrCoOwner(
              member
            )
          ) {
            rows.push(
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `owner_end:${app.id}`
                    )
                    .setLabel(
                      'End Interview'
                    )
                    .setEmoji(
                      '🏁'
                    )
                    .setStyle(
                      ButtonStyle.Danger
                    )
                )
            );
          }

          return interaction.reply({
            embeds: [
              closingBriefEmbed(
                app
              ),
            ],

            components:
              rows,

            flags:
              MessageFlags.Ephemeral,
          });
        }

        return interaction.reply({
          embeds: [
            categorySelectionEmbed(
              app,
              interaction.user.id,
              session.current_category
            ),
          ],

          components:
            categorySelectionRows(
              app,
              interaction.user.id,
              session.current_category
            ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ---------------- CATEGORY NAVIGATION ----------------

      if (
        interaction.isButton() &&
        (
          interaction.customId.startsWith(
            'cat_prev:'
          ) ||
          interaction.customId.startsWith(
            'cat_next:'
          )
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        const session =
          getSession(
            app.id,
            interaction.user.id
          );

        const forward =
          interaction.customId.startsWith(
            'cat_next:'
          );

        if (
          forward &&
          session.current_category >=
            0 &&
          session.current_category <
            CATEGORY_COUNT
        ) {
          const progress =
            getCategoryProgress(
              app.id,
              interaction.user.id,
              session.current_category
            );

          if (
            selectedQuestions(
              progress
            ).length !==
            3
          ) {
            return safeEphemeral(
              interaction,
              '❌ Select exactly 3 questions first.'
            );
          }

          if (
            !Number.isInteger(
              progress.score
            )
          ) {
            return safeEphemeral(
              interaction,
              '❌ Grade this category before moving on.'
            );
          }
        }

        const next =
          Math.max(
            -1,
            Math.min(
              CATEGORY_COUNT,
              session.current_category +
                (
                  forward
                    ? 1
                    : -1
                )
            )
          );

        db.prepare(`
          UPDATE interview_sessions
          SET current_category = ?
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          next,
          app.id,
          interaction.user.id
        );

        if (
          next ===
          -1
        ) {
          return interaction.update({
            embeds: [
              openingBriefEmbed(
                app
              ),
            ],

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `cat_next:${app.id}`
                    )
                    .setLabel(
                      'Next Category'
                    )
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],
          });
        }

        if (
          next >=
          CATEGORY_COUNT
        ) {
          const rows = [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `cat_prev:${app.id}`
                  )
                  .setLabel(
                    'Previous Category'
                  )
                  .setStyle(
                    ButtonStyle.Secondary
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `view_progress:${app.id}`
                  )
                  .setLabel(
                    'View My Scores'
                  )
                  .setStyle(
                    ButtonStyle.Secondary
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `finish_scoring:${app.id}`
                  )
                  .setLabel(
                    'Finish My Scoring'
                  )
                  .setStyle(
                    ButtonStyle.Success
                  )
              ),
          ];

          if (
            isOwnerOrCoOwner(
              member
            )
          ) {
            rows.push(
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `owner_end:${app.id}`
                    )
                    .setLabel(
                      'End Interview'
                    )
                    .setEmoji(
                      '🏁'
                    )
                    .setStyle(
                      ButtonStyle.Danger
                    )
                )
            );
          }

          return interaction.update({
            embeds: [
              closingBriefEmbed(
                app
              ),
            ],

            components:
              rows,
          });
        }

        return interaction.update({
          embeds: [
            categorySelectionEmbed(
              app,
              interaction.user.id,
              next
            ),
          ],

          components:
            categorySelectionRows(
              app,
              interaction.user.id,
              next
            ),
        });
      }

      // ---------------- SELECT 3 -> IMMEDIATE GRADING ----------------

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick3:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        if (
          interaction.values.length !==
          3
        ) {
          return safeEphemeral(
            interaction,
            '❌ Select exactly 3 questions.'
          );
        }

        db.prepare(`
          UPDATE category_progress
          SET
            selected_questions = ?,
            score = NULL
          WHERE app_id = ?
            AND staff_id = ?
            AND category_index = ?
        `).run(
          JSON.stringify(
            interaction.values.map(
              Number
            )
          ),
          app.id,
          interaction.user.id,
          categoryIndex
        );

        // Immediately show all 3 selected questions
        // plus grading buttons.
        return interaction.update({
          embeds: [
            selectedThreeEmbed(
              app,
              interaction.user.id,
              categoryIndex
            ),
          ],

          components:
            selectedThreeRows(
              app,
              categoryIndex
            ),
        });
      }

      // ---------------- GRADE WHOLE CATEGORY ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'grade_cat:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryRaw,
          scoreRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        const score =
          Number(
            scoreRaw
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        if (
          ![
            0,
            1,
            2,
            3,
          ].includes(
            score
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Invalid score.'
          );
        }

        db.prepare(`
          UPDATE category_progress
          SET score = ?
          WHERE app_id = ?
            AND staff_id = ?
            AND category_index = ?
        `).run(
          score,
          app.id,
          interaction.user.id,
          categoryIndex
        );

        return interaction.update({
          embeds: [
            selectedThreeEmbed(
              app,
              interaction.user.id,
              categoryIndex
            ),
          ],

          components:
            selectedThreeRows(
              app,
              categoryIndex
            ),
        });
      }

      // ---------------- NOTES ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'category_notes:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        const progress =
          getCategoryProgress(
            app.id,
            interaction.user.id,
            categoryIndex
          );

        return interaction.showModal(
          notesModal(
            app.id,
            categoryIndex,
            progress.notes ||
              ''
          )
        );
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'notes_modal:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        const notes =
          interaction.fields
            .getTextInputValue(
              'notes'
            )
            .trim();

        db.prepare(`
          UPDATE category_progress
          SET notes = ?
          WHERE app_id = ?
            AND staff_id = ?
            AND category_index = ?
        `).run(
          notes,
          app.id,
          interaction.user.id,
          categoryIndex
        );

        return safeEphemeral(
          interaction,
          '✅ Notes saved.'
        );
      }

      // ---------------- CHANGE SELECTED QUESTIONS ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_category:'
        )
      ) {
        const [
          ,
          appIdRaw,
          categoryRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        const categoryIndex =
          Number(
            categoryRaw
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        return interaction.update({
          embeds: [
            categorySelectionEmbed(
              app,
              interaction.user.id,
              categoryIndex
            ),
          ],

          components:
            categorySelectionRows(
              app,
              interaction.user.id,
              categoryIndex
            ),
        });
      }

      // ---------------- VIEW SCORES ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'view_progress:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        return interaction.reply({
          embeds: [
            scoreProgressEmbed(
              app,
              interaction.user.id
            ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ---------------- FINISH SCORING ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'finish_scoring:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        if (
          !getInterviewers(
            app.id
          ).includes(
            interaction.user.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Interviewer only.'
          );
        }

        const session =
          getSession(
            app.id,
            interaction.user.id
          );

        if (
          session.current_category <
          CATEGORY_COUNT
        ) {
          return safeEphemeral(
            interaction,
            '❌ Reach the Closing Brief first.'
          );
        }

        let total = 0;

        for (
          let i = 0;
          i < CATEGORY_COUNT;
          i++
        ) {
          const progress =
            getCategoryProgress(
              app.id,
              interaction.user.id,
              i
            );

          if (
            selectedQuestions(
              progress
            ).length !==
            3
          ) {
            return safeEphemeral(
              interaction,
              `❌ ${QUESTION_CATEGORIES[i].name}: select exactly 3 questions.`
            );
          }

          if (
            !Number.isInteger(
              progress.score
            )
          ) {
            return safeEphemeral(
              interaction,
              `❌ ${QUESTION_CATEGORIES[i].name}: grade the category.`
            );
          }

          total +=
            progress.score;
        }

        db.prepare(`
          UPDATE interview_sessions
          SET finished = 1
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        return safeEphemeral(
          interaction,
          `✅ Scoring finished. Final score: **${total}/${MAX_SCORE_PER_INTERVIEWER}**.`
        );
      }

      // ---------------- END INTERVIEW ----------------

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'owner_end:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(
                  ':'
                )[1]
            )
          );

        if (
          !app ||
          interaction.channelId !==
            app.scoring_channel_id
        ) {
          return safeEphemeral(
            interaction,
            '❌ End Interview only works in the scoring channel.'
          );
        }

        if (
          !allInterviewersFinished(
            app.id
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Every participating interviewer must finish scoring first.'
          );
        }

        return interaction.reply({
          content: [
            '🏁 **End this interview?**',

            '',

            `✅ Results + notes will first be saved permanently in <#${INTERVIEW_RESULTS_CHANNEL_ID}>.`,

            '',

            '🗑️ Then ALL temporary interview channels will be deleted:',

            '• Applicant interview text channel',

            '• Interview voice channel',

            '• Scoring channel itself',
          ].join('\n'),

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `confirm_end:${app.id}`
                  )
                  .setLabel(
                    'Yes — End Interview'
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `cancel_end:${app.id}`
                  )
                  .setLabel(
                    'Keep Open'
                  )
                  .setStyle(
                    ButtonStyle.Secondary
                  )
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'cancel_end:'
        )
      ) {
        return interaction.update({
          content:
            '✅ Interview remains open.',

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'confirm_end:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(
                ':'
              )[1]
          );

        await interaction.deferUpdate();

        try {
          await endInterview(
            appId,
            guild
          );

          return interaction.editReply({
            content:
              '✅ Interview ended. Results + notes were saved, then the interview text, voice, and scoring channels were deleted.',

            components: [],
          });
        } catch (
          error
        ) {
          return interaction.editReply({
            content:
              `❌ ${error.message}`,

            components: [],
          });
        }
      }

      // ---------------- FINAL RESULT ----------------

      if (
        interaction.isButton() &&
        /^final_(accept|reject|review):/.test(
          interaction.customId
        )
      ) {
        if (
          !isAuthorizedStaff(
            member
          )
        ) {
          return safeEphemeral(
            interaction,
            '❌ Staff only.'
          );
        }

        const [
          action,
          appIdRaw,
        ] =
          interaction.customId
            .split(
              ':'
            );

        const app =
          getApplication(
            Number(
              appIdRaw
            )
          );

        if (
          !app
        ) {
          return safeEphemeral(
            interaction,
            'Application not found.'
          );
        }

        const status =
          action ===
            'final_accept'
            ? 'accepted'
            : action ===
                'final_reject'
              ? 'rejected'
              : 'further_review';

        db.prepare(`
          UPDATE applications
          SET status = ?
          WHERE id = ?
        `).run(
          status,
          app.id
        );

        await postSubmittedApplication(
          app.id
        );

        return safeEphemeral(
          interaction,
          `✅ Marked ${statusLabel(
            status
          )}. Applicant was not notified.`
        );
      }

    } catch (
      error
    ) {
      console.error(
        'Interaction error:',
        error
      );

      await safeEphemeral(
        interaction,
        `❌ ${error.message}`
      );
    }
  }
);

client.login(
  DISCORD_TOKEN
);
