            .roles.everyone.id,

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

        {
          id:
            SENIOR_STAFF_ROLE_ID,

          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
          ],
        },
      ],
    });

  db.prepare(`
    UPDATE applications
    SET interview_voice_channel_id = ?
    WHERE id = ?
  `).run(
    voice.id,
    app.id
  );

  if (
    app.mode === 'test'
  ) {
    markTestCheck(
      'voice'
    );
  }

  return voice;
}

// =====================================================
// CREATE SCORING CHANNEL
// Category:
// 1548862844186001478
// =====================================================

async function createScoringChannel(
  app,
  guild
) {
  let channel =
    app.scoring_channel_id
      ? await guild.channels
          .fetch(
            app.scoring_channel_id
          )
          .catch(() => null)
      : null;

  if (channel) {
    return channel;
  }

  const applicant =
    await guild.members
      .fetch(
        app.user_id
      )
      .catch(() => null);

  channel =
    await guild.channels.create({
      name:
        `interview-scores-${slugify(
          applicant?.user?.username ||
          'applicant'
        )}`,

      type:
        ChannelType.GuildText,

      parent:
        SCORING_CATEGORY_ID,

      permissionOverwrites:
        scoringPermissions(
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

  const interviewers =
    getInterviewers(
      app.id
    );

  await channel.send({
    content:
      interviewers.length
        ? interviewers
            .map(
              id =>
                `<@${id}>`
            )
            .join(' ')
        : `<@&${SENIOR_STAFF_ROLE_ID}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          '📝 Interview Questions & Scoring'
        )
        .setDescription([
          `**Applicant:** <@${app.user_id}>`,
          '',
          '### How scoring works',
          '',
          'Click **Enter Question Number**.',
          '',
          'Type a number from **1 to 21**.',
          '',
          'The bot will display that interview question.',
          '',
          'Then click **Enter Score** and type:',
          '',
          '**3** = Excellent',
          '**2** = Good',
          '**1** = Weak',
          '**0** = Failed / No Answer',
          '',
          'Each interviewer scores independently.',
          '',
          '**Maximum:** 63 points per interviewer.',
          '',
          'When you have scored all 21 questions, click **Finish My Scoring**.',
        ].join('\n')),
    ],

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `choose_question:${app.id}`
            )
            .setLabel(
              'Enter Question Number'
            )
            .setEmoji('🔢')
            .setStyle(
              ButtonStyle.Primary
            ),

          new ButtonBuilder()
            .setCustomId(
              `view_progress:${app.id}`
            )
            .setLabel(
              'View My Progress'
            )
            .setEmoji('📊')
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
            .setEmoji('✅')
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `cancel_staff_interview:${app.id}`
            )
            .setLabel(
              'Cancel Interviewing'
            )
            .setEmoji('❌')
            .setStyle(
              ButtonStyle.Danger
            )
        ),
    ],
  });

  return channel;
}

// =====================================================
// START INTERVIEW
// OWNER / CO-OWNER ONLY
// =====================================================

async function startInterview(
  appId,
  guild
) {
  let app =
    getApplication(appId);

  if (!app) {
    throw new Error(
      'Application not found.'
    );
  }

  if (
    app.status ===
    'in_progress'
  ) {
    throw new Error(
      'This interview has already started.'
    );
  }

  const approval =
    await approvalStatus(
      app.id,
      guild
    );

  if (!approval.confirmed) {
    throw new Error(
      'The interview is not confirmed yet. It needs 2 Senior Staff confirmations or 1 Owner/Co-Owner confirmation.'
    );
  }

  let questions =
    getQuestions(app);

  if (!questions.length) {
    questions =
      createRandomQuestions();

    saveQuestions(
      app.id,
      questions
    );
  }

  const voice =
    await createVoiceChannel(
      app,
      guild
    );

  app =
    getApplication(
      app.id
    );

  const scoringChannel =
    await createScoringChannel(
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

  // ===============================================
  // POST START MESSAGE IN THE SAME NOTIFICATION
  // CHANNEL WHERE THE INTERVIEW WAS CONFIRMED
  // ===============================================

  const notificationChannel =
    await getTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  const interviewers =
    getInterviewers(
      app.id
    );

  if (notificationChannel) {
    await notificationChannel.send({
      content: [
        `<@${app.user_id}>`,
        ...interviewers.map(
          id =>
            `<@${id}>`
        ),
      ].join(' '),

      embeds: [
        new EmbedBuilder()
          .setTitle(
            '🎙️ Interview Has Started'
          )
          .setDescription([
            `**Applicant:** <@${app.user_id}>`,
            '',
            'The interview team is ready.',
            '',
            `### 🔊 Join Voice Interview`,
            `${voice}`,
            '',
            '**Click the voice channel above to join the interview.**',
            '',
            `Staff scoring: ${scoringChannel}`,
          ].join('\n')),
      ],

      components: [
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                `applicant_cancel:${app.id}`
              )
              .setLabel(
                'Cancel Interviewing'
              )
              .setEmoji('❌')
              .setStyle(
                ButtonStyle.Danger
              )
          ),
      ],
    });
  }

  // ===============================================
  // APPLICANT INTERVIEW CHANNEL
  // Applicant only gets:
  // CANCEL INTERVIEWING
  //
  // NO START
  // NO END
  // NO SCORING
  // ===============================================

  const applicantChannel =
    await getTextChannel(
      app.interview_text_channel_id
    );

  if (applicantChannel) {
    await applicantChannel.send({
      content:
        `<@${app.user_id}>`,

      embeds: [
        new EmbedBuilder()
          .setTitle(
            '🎙️ Your Interview Is Ready'
          )
          .setDescription([
            'Staff has started your interview.',
            '',
            '### Join the voice channel:',
            `${voice}`,
            '',
            '**Click the voice channel above to join.**',
            '',
            'If you can no longer continue with the interview, use the button below.',
          ].join('\n')),
      ],

      components: [
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                `applicant_cancel:${app.id}`
              )
              .setLabel(
                'Cancel Interviewing'
              )
              .setEmoji('❌')
              .setStyle(
                ButtonStyle.Danger
              )
          ),
      ],
    });
  }

  await postApplication(
    app.id
  );

  return {
    voice,
    scoringChannel,
  };
}

// =====================================================
// SCORE SESSION
// =====================================================

function getScoreSession(
  appId,
  staffId
) {
  let session =
    db.prepare(`
      SELECT *
      FROM score_sessions
      WHERE app_id = ?
        AND staff_id = ?
    `).get(
      appId,
      staffId
    );

  if (!session) {
    db.prepare(`
      INSERT INTO score_sessions(
        app_id,
        staff_id,
        current_index,
        finished
      )
      VALUES(
        ?,
        ?,
        0,
        0
      )
    `).run(
      appId,
      staffId
    );

    session = {
      app_id:
        appId,

      staff_id:
        staffId,

      current_index:
        0,

      finished:
        0,
    };
  }

  return session;
}

function interviewerScore(
  appId,
  staffId
) {
  return db.prepare(`
    SELECT
      COALESCE(
        SUM(score),
        0
      ) AS total,

      COUNT(*) AS count

    FROM scores

    WHERE app_id = ?
      AND staff_id = ?
  `).get(
    appId,
    staffId
  );
}

// =====================================================
// QUESTION DISPLAY
// =====================================================

function questionEmbed(
  app,
  staffId,
  index
) {
  const questions =
    getQuestions(app);

  if (
    index < 0 ||
    index >= questions.length
  ) {
    return new EmbedBuilder()
      .setTitle(
        '❌ Question Not Found'
      );
  }

  const question =
    questions[index];

  const saved =
    db.prepare(`
      SELECT score
      FROM scores
      WHERE app_id = ?
        AND staff_id = ?
        AND question_key = ?
    `).get(
      app.id,
      staffId,
      question.key
    );

  const progress =
    interviewerScore(
      app.id,
      staffId
    );

  return new EmbedBuilder()
    .setTitle(
      `📝 Interview Question ${index + 1}`
    )
    .setDescription([
      `**Applicant:** <@${app.user_id}>`,
      '',
      `### ${question.category}`,
      '',
      `## Question ${index + 1} of 21`,
      '',
      question.question,
      '',
      `**Current Score:** ${
        saved
          ? `${saved.score}/3`
          : 'Not scored yet'
      }`,
      '',
      `**Questions Scored:** ${progress.count}/21`,
      '',
      '**Scoring**',
      '3 = Excellent',
      '2 = Good',
      '1 = Weak',
      '0 = Failed / No Answer',
    ].join('\n'));
}

function questionRows(
  app,
  index
) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `type_score:${app.id}:${index}`
          )
          .setLabel(
            'Enter Score'
          )
          .setEmoji('✏️')
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `choose_question:${app.id}`
          )
          .setLabel(
            'Enter Another Question #'
          )
          .setEmoji('🔢')
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `finish_scoring:${app.id}`
          )
          .setLabel(
            'Finish My Scoring'
          )
          .setEmoji('✅')
          .setStyle(
            ButtonStyle.Secondary
          )
      ),
  ];
}

// =====================================================
// QUESTION NUMBER MODAL
// =====================================================

function questionNumberModal(
  appId
) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `question_number_modal:${appId}`
      )
      .setTitle(
        'Choose Interview Question'
      );

  const number =
    new TextInputBuilder()
      .setCustomId(
        'question_number'
      )
      .setLabel(
        'Question number (1-21)'
      )
      .setPlaceholder(
        'Example: 7'
      )
      .setStyle(
        TextInputStyle.Short
      )
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        number
      )
  );

  return modal;
}

// =====================================================
// SCORE MODAL
// =====================================================

function scoreModal(
  appId,
  index
) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `score_modal:${appId}:${index}`
      )
      .setTitle(
        `Score Question ${index + 1}`
      );

  const score =
    new TextInputBuilder()
      .setCustomId(
        'score'
      )
      .setLabel(
        'Score from 0 to 3'
      )
      .setPlaceholder(
        '0, 1, 2, or 3'
      )
      .setStyle(
        TextInputStyle.Short
      )
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(1);

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        score
      )
  );

  return modal;
}

// =====================================================
// CATEGORY SCORES
// =====================================================

function categoryScores(
  app,
  staffId
) {
  const questions =
    getQuestions(app);

  return QUESTION_CATEGORIES.map(
    (
      category,
      categoryIndex
    ) => {
      const selected =
        questions.filter(
          question =>
            question.categoryIndex ===
            categoryIndex
        );

      let total = 0;

      for (
        const question
        of selected
      ) {
        const saved =
          db.prepare(`
            SELECT score
            FROM scores
            WHERE app_id = ?
              AND staff_id = ?
              AND question_key = ?
          `).get(
            app.id,
            staffId,
            question.key
          );

        total +=
          saved?.score || 0;
      }

      return {
        name:
          category.name,

        score:
          total,

        max:
          9,
      };
    }
  );
}

// =====================================================
// CHECK ALL SCORING FINISHED
// =====================================================

function allInterviewersFinished(
  appId
) {
  const interviewers =
    getInterviewers(
      appId
    );

  if (!interviewers.length) {
    return false;
  }

  return interviewers.every(
    staffId => {
      const row =
        db.prepare(`
          SELECT finished
          FROM score_sessions
          WHERE app_id = ?
            AND staff_id = ?
        `).get(
          appId,
          staffId
        );

      return (
        row?.finished === 1
      );
    }
  );
}

// =====================================================
// PERMANENT RESULTS
// =====================================================

async function postResults(
  appId
) {
  const app =
    getApplication(
      appId
    );

  if (!app) {
    throw new Error(
      'Application not found.'
    );
  }

  const resultsChannel =
    await getTextChannel(
      INTERVIEW_RESULTS_CHANNEL_ID
    );

  if (!resultsChannel) {
    throw new Error(
      'Permanent scores channel was not found.'
    );
  }

  const interviewers =
    getInterviewers(
      app.id
    );

  let combinedScore = 0;
  let combinedMaximum = 0;

  const fields = [];

  for (
    const staffId
    of interviewers
  ) {
    const total =
      interviewerScore(
        app.id,
        staffId
      );

    combinedScore +=
      total.total;

    combinedMaximum +=
      63;

    fields.push({
      name:
        `📝 Interviewer <@${staffId}>`,

      value: [
        `**Score: ${total.total}/63**`,
        `**Percentage: ${(
          total.total /
          63 *
          100
        ).toFixed(1)}%**`,
      ].join('\n'),

      inline:
        false,
    });

    const categories =
      categoryScores(
        app,
        staffId
      );

    fields.push({
      name:
        'Category Breakdown',

      value:
        categories
          .map(
            category =>
              `${category.name}: **${category.score}/${category.max}**`
          )
          .join('\n')
          .slice(
            0,
            1024
          ),

      inline:
        false,
    });
  }

  const overall =
    combinedMaximum > 0
      ? (
          combinedScore /
          combinedMaximum *
          100
        ).toFixed(1)
      : '0.0';

  fields.push({
    name:
      '🏆 Combined Result',

    value: [
      `**${combinedScore}/${combinedMaximum}**`,
      `**${overall}%**`,
    ].join('\n'),

    inline:
      false,
  });

  const message =
    await resultsChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(
            app.mode === 'test'
              ? '🧪 TEST Interview Scores'
              : '📊 Crafted SMP Staff Interview Scores'
          )
          .setDescription([
            `**Applicant:** <@${app.user_id}>`,
            '',
            `**Application ID:** ${app.id}`,
            '',
            '**Permanent interview results**',
            '',
            'The temporary interview channels can be deleted without deleting these scores.',
          ].join('\n'))
          .addFields(
            fields
          )
          .setTimestamp(),
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
              .setEmoji('✅')
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
              .setEmoji('❌')
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
              .setEmoji('🟡')
              .setStyle(
                ButtonStyle.Secondary
              )
          ),
      ],
    });

  if (
    app.mode === 'test'
  ) {
    markTestCheck(
      'results'
    );
  }

  return message;
}

// =====================================================
// DELETE TEMPORARY INTERVIEW CHANNELS
// =====================================================

async function cleanupInterviewChannels(
  app,
  guild
) {
  const ids = [
    app.interview_voice_channel_id,
    app.scoring_channel_id,
    app.interview_text_channel_id,
  ];

  for (
    const channelId
    of ids
  ) {
    if (!channelId) {
      continue;
    }

    const channel =
      await guild.channels
        .fetch(
          channelId
        )
        .catch(() => null);

    if (!channel) {
      continue;
    }

    await channel
      .delete(
        `Staff interview ${app.id} completed`
      )
      .catch(
        error => {
          console.error(
            `Could not delete ${channelId}:`,
            error
          );
        }
      );
  }

  db.prepare(`
    UPDATE applications
    SET
      interview_voice_channel_id = NULL,
      scoring_channel_id = NULL,
      interview_text_channel_id = NULL
    WHERE id = ?
  `).run(
    app.id
  );

  if (
    app.mode === 'test'
  ) {
    markTestCheck(
      'cleanup'
    );
  }
}

// =====================================================
// END MEETING
// OWNER / CO-OWNER ONLY
// =====================================================

async function endMeeting(
  appId,
  guild
) {
  let app =
    getApplication(
      appId
    );

  if (!app) {
    throw new Error(
      'Application not found.'
    );
  }

  if (
    app.status !==
    'in_progress'
  ) {
    throw new Error(
      'This interview is not currently in progress.'
    );
  }

  const interviewers =
    getInterviewers(
      app.id
    );

  if (!interviewers.length) {
    throw new Error(
      'There are no interviewers attached to this interview.'
    );
  }

  if (
    !allInterviewersFinished(
      app.id
    )
  ) {
    const unfinished = [];

    for (
      const staffId
      of interviewers
    ) {
      const row =
        db.prepare(`
          SELECT finished
          FROM score_sessions
          WHERE app_id = ?
            AND staff_id = ?
        `).get(
          app.id,
          staffId
        );

      if (
        row?.finished !== 1
      ) {
        unfinished.push(
          `<@${staffId}>`
        );
      }
    }

    throw new Error(
      `The following interviewers still need to finish scoring: ${unfinished.join(', ')}`
    );
  }

  // ===============================================
  // SAVE PERMANENT RESULTS FIRST
  // ===============================================

  await postResults(
    app.id
  );

  // ===============================================
  // THEN COMPLETE APPLICATION
  // ===============================================

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

  app =
    getApplication(
      app.id
    );

  await postApplication(
    app.id
  );

  // ===============================================
  // THEN DELETE TEMPORARY CHANNELS
  // ===============================================

  await cleanupInterviewChannels(
    app,
    guild
  );
}

// =====================================================
// INTERVIEW REMINDERS
// =====================================================

async function sendReminder(
  app,
  label
) {
  const channel =
    await getTextChannel(
      INTERVIEW_NOTIFICATION_CHANNEL_ID
    );

  if (!channel) {
    return;
  }

  const interviewers =
    getInterviewers(
      app.id
    );

  await channel.send({
    content: [
      `<@${app.user_id}>`,
      ...interviewers.map(
        id =>
          `<@${id}>`
      ),
    ].join(' '),

    embeds: [
      new EmbedBuilder()
        .setTitle(
          `⏰ Interview Reminder — ${label}`
        )
        .setDescription([
          `**Applicant:** <@${app.user_id}>`,
          '',
          `**Interview:** <t:${app.interview_ts}:F>`,
          '',
          `**Starts:** <t:${app.interview_ts}:R>`,
        ].join('\n')),
    ],

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `applicant_cancel:${app.id}`
            )
            .setLabel(
              'Cancel Interviewing'
            )
            .setEmoji('❌')
            .setStyle(
              ButtonStyle.Danger
            )
        ),
    ],
  });

  if (
    app.mode === 'test'
  ) {
    markTestCheck(
      'reminders'
    );
  }
}

async function reminderSweep() {
  const applications =
    db.prepare(`
      SELECT *
      FROM applications
      WHERE mode = 'real'
        AND status = 'confirmed'
    `).all();

  const now =
    unixNow();

  const reminderTimes = [
    {
      key:
        '24h',

      seconds:
        24 * 60 * 60,

      label:
        '24 Hours',
    },

    {
      key:
        '1h',

      seconds:
        60 * 60,

      label:
        '1 Hour',
    },

    {
      key:
        '10m',

      seconds:
        10 * 60,

      label:
        '10 Minutes',
    },
  ];

  for (
    const app
    of applications
  ) {
    for (
      const reminder
      of reminderTimes
    ) {
      const remaining =
        app.interview_ts -
        now;

      if (
        Math.abs(
          remaining -
          reminder.seconds
        ) > 90
      ) {
        continue;
      }

      const sent =
        db.prepare(`
          SELECT 1
          FROM reminders
          WHERE app_id = ?
            AND reminder_key = ?
        `).get(
          app.id,
          reminder.key
        );

      if (sent) {
        continue;
      }

      await sendReminder(
        app,
        reminder.label
      );

      db.prepare(`
        INSERT INTO reminders(
          app_id,
          reminder_key,
          sent_at
        )
        VALUES(
          ?,
          ?,
          ?
        )
      `).run(
        app.id,
        reminder.key,
        Date.now()
      );
    }
  }
}

// =====================================================
// RESET TEST DATA
// =====================================================

async function resetTestData(
  guild
) {
  const applications =
    db.prepare(`
      SELECT *
      FROM applications
      WHERE mode = 'test'
    `).all();

  for (
    const app
    of applications
  ) {
    await cleanupInterviewChannels(
      app,
      guild
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

    db.prepare(`
      DELETE FROM scores
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM score_sessions
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM reminders
      WHERE app_id = ?
    `).run(
      app.id
    );

    db.prepare(`
      DELETE FROM applications
      WHERE id = ?
    `).run(
      app.id
    );
  }

  const testChannelId =
    getSetting(
      'test_application_channel'
    );

  if (testChannelId) {
    const channel =
      await guild.channels
        .fetch(
          testChannelId
        )
        .catch(() => null);

    if (channel) {
      await channel
        .delete()
        .catch(() => null);
    }
  }

  setSetting(
    'test_application_channel',
    ''
  );

  setSetting(
    'system_mode',
    'closed'
  );

  resetTestChecks();
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
      const guild =
        await client.guilds
          .fetch(
            GUILD_ID
          );

      await ensureManagementPanel();

      await reminderSweep();

      setInterval(
        () => {
          reminderSweep()
            .catch(
              console.error
            );
        },
        60_000
      );

      console.log(
        '✅ Crafted SMP Staff Application System ready.'
      );

    } catch (error) {
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
        await client.guilds
          .fetch(
            GUILD_ID
          );

      const member =
        interaction.member ||
        await guild.members
          .fetch(
            interaction.user.id
          )
          .catch(() => null);

      // ===============================================
      // TESTING MODE
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'testing_mode'
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        await deletePublicChannel(
          guild
        );

        setSetting(
          'system_mode',
          'test'
        );

        resetTestChecks();

        await ensureManagementPanel();

        return safeReply(
          interaction,
          '🧪 Testing Mode enabled. Next choose a test applicant.'
        );
      }

      // ===============================================
      // CHOOSE TEST APPLICANT
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'test_applicant'
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const select =
          new UserSelectMenuBuilder()
            .setCustomId(
              'test_user_select'
            )
            .setPlaceholder(
              'Choose test applicant'
            )
            .setMinValues(1)
            .setMaxValues(1);

        return interaction.reply({
          content:
            'Choose the person who will test the application system:',

          components: [
            new ActionRowBuilder()
              .addComponents(
                select
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      if (
        interaction.isUserSelectMenu() &&
        interaction.customId ===
          'test_user_select'
      ) {
        const userId =
          interaction.values[0];

        const channel =
          await createTestChannel(
            guild,
            userId
          );

        return interaction.update({
          content:
            `✅ Test applicant selected: <@${userId}>\n${channel}`,

          components: [],
        });
      }

      // ===============================================
      // CHECKLIST
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'checklist'
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                '📋 Testing Checklist'
              )
              .setDescription(
                checklistText()
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // OPEN PUBLIC APPLICATIONS
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'open_public'
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const channel =
          await createPublicChannel(
            guild
          );

        setSetting(
          'system_mode',
          'public'
        );

        await ensureManagementPanel();

        return safeReply(
          interaction,
          `✅ Public applications are open: ${channel}`
        );
      }

      // ===============================================
      // CLOSE PUBLIC APPLICATIONS
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'close_public'
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        await deletePublicChannel(
          guild
        );

        setSetting(
          'system_mode',
          'closed'
        );

        await ensureManagementPanel();

        return safeReply(
          interaction,
          '🔴 Public staff applications are now closed.'
        );
      }

      // ===============================================
      // RESET TEST
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'reset_test'
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
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
          '✅ Test data has been reset.'
        );
      }

      // ===============================================
      // APPLY BUTTON
      // ===============================================

      if (
        interaction.isButton() &&
        (
          interaction.customId ===
            'apply_test' ||
          interaction.customId ===
            'apply_real'
        )
      ) {
        const mode =
          interaction.customId ===
          'apply_test'
            ? 'test'
            : 'real';

        if (
          mode === 'test' &&
          getSetting(
            'system_mode'
          ) !== 'test'
        ) {
          return safeReply(
            interaction,
            'Testing Mode is not enabled.'
          );
        }

        if (
          mode === 'real' &&
          getSetting(
            'system_mode'
          ) !== 'public'
        ) {
          return safeReply(
            interaction,
            'Staff applications are closed.'
          );
        }

        return interaction.showModal(
          applicationModal(
            mode
          )
        );
      }

      // ===============================================
      // APPLICATION MODAL
      // ===============================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'application_modal:'
        )
      ) {
        const mode =
          interaction.customId
            .split(':')[1];

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

        if (
          mode === 'test'
        ) {
          markTestCheck(
            'application_form'
          );
        }

        return interaction.reply({
          ...datePicker(
            app,
            0
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // DATE PAGE BUTTONS
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'date_page:'
        )
      ) {
        const [
          ,
          appId,
          page,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        return interaction.update(
          datePicker(
            app,
            Number(
              page
            )
          )
        );
      }

      // ===============================================
      // PICK DATE
      // ===============================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(
          'pick_date:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        return interaction.update(
          timePicker(
            app,
            interaction.values[0]
          )
        );
      }

      // ===============================================
      // BACK TO DATES
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_dates:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        return interaction.update(
          datePicker(
            app,
            0
          )
        );
      }

      // ===============================================
      // PICK TIME
      // ===============================================

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
            .split(':');

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        return interaction.update(
          timezonePicker(
            app,
            dateISO,
            interaction.values[0]
          )
        );
      }

      // ===============================================
      // BACK TO TIMES
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'back_times:'
        )
      ) {
        const [
          ,
          appId,
          dateISO,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(
              appId
            )
          );

        return interaction.update(
          timePicker(
            app,
            dateISO
          )
        );
      }

      // ===============================================
      // PICK TIMEZONE
      // ===============================================

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
            .split(':');

        const app =
          getApplication(
            Number(
              appId
            )
          );

        return saveSchedule(
          interaction,
          app,
          dateISO,
          timeValue,
          interaction.values[0]
        );
      }

      // ===============================================
      // CONFIRM / APPROVE INTERVIEW
      // Approving Senior Staff becomes interviewer.
      //
      // 2 Senior Staff = confirmed.
      // Owner/Co-Owner = immediate confirmation.
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'approve:'
        )
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        if (!app) {
          return safeReply(
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

        // Approving staff member becomes an interviewer.
        db.prepare(`
          INSERT OR IGNORE INTO interviewers(
            app_id,
            staff_id
          )
          VALUES(
            ?,
            ?
          )
        `).run(
          app.id,
          interaction.user.id
        );

        const status =
          await approvalStatus(
            app.id,
            guild
          );

        if (
          app.mode === 'test'
        ) {
          markTestCheck(
            'staff_approvals'
          );

          if (
            isOwnerOrCoOwner(
              member
            )
          ) {
            markTestCheck(
              'owner_override'
            );
          }
        }

        await postApplication(
          app.id
        );

        if (
          status.confirmed
        ) {
          const freshApp =
            getApplication(
              app.id
            );

          if (
            freshApp.status !==
            'confirmed'
          ) {
            await confirmInterview(
              app.id,
              guild
            );
          }

          return safeReply(
            interaction,
            '✅ Interview confirmed.'
          );
        }

        return safeReply(
          interaction,
          `✅ Confirmation recorded. ${status.seniorCount}/2 Senior Staff confirmations.`
        );
      }

      // ===============================================
      // RESCHEDULE
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'reschedule:'
        )
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
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

        const user =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(() => null);

        if (user) {
          await user.send({
            content:
              '📅 Crafted SMP Staff needs you to choose a different interview date/time.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      `choose_new_time:${app.id}`
                    )
                    .setLabel(
                      'Choose New Date & Time'
                    )
                    .setEmoji('📅')
                    .setStyle(
                      ButtonStyle.Primary
                    )
                ),
            ],
          }).catch(() => null);
        }

        await postApplication(
          app.id
        );

        return safeReply(
          interaction,
          '📅 Applicant was asked to choose another interview time.'
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'choose_new_time:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeReply(
            interaction,
            '❌ This button belongs to the applicant.'
          );
        }

        return interaction.reply({
          ...datePicker(
            app,
            0
          ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // APPLICANT CANCEL INTERVIEWING
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'applicant_cancel:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        if (
          interaction.user.id !==
          app.user_id
        ) {
          return safeReply(
            interaction,
            '❌ Only the applicant can use this button.'
          );
        }

        return interaction.reply({
          content: [
            '⚠️ **Cancel your interview?**',
            '',
            'This will cancel your current interview application and remove the temporary interview channels.',
          ].join('\n'),

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `confirm_applicant_cancel:${app.id}`
                  )
                  .setLabel(
                    'Yes — Cancel Interview'
                  )
                  .setEmoji('❌')
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `keep_applicant_interview:${app.id}`
                  )
                  .setLabel(
                    'Keep Interview'
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
          'keep_applicant_interview:'
        )
      ) {
        return interaction.update({
          content:
            '✅ Your interview is still scheduled.',

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'confirm_applicant_cancel:'
        )
      ) {
        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (
          !app ||
          app.user_id !==
            interaction.user.id
        ) {
          return safeReply(
            interaction,
            '❌ Only the applicant can cancel this interview.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET status = 'rejected'
          WHERE id = ?
        `).run(
          app.id
        );

        await cleanupInterviewChannels(
          app,
          guild
        );

        await postApplication(
          app.id
        );

        const notifications =
          await getTextChannel(
            INTERVIEW_NOTIFICATION_CHANNEL_ID
          );

        if (notifications) {
          await notifications.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  '❌ Interview Cancelled by Applicant'
                )
                .setDescription(
                  `<@${app.user_id}> cancelled their staff interview.`
                ),
            ],
          });
        }

        return interaction.update({
          content:
            '❌ Your staff interview has been cancelled.',

          components: [],
        });
      }

      // ===============================================
      // STAFF CANCEL INTERVIEWING
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'cancel_staff_interview:'
        )
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
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
          DELETE FROM scores
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          DELETE FROM score_sessions
          WHERE app_id = ?
            AND staff_id = ?
        `).run(
          app.id,
          interaction.user.id
        );

        await postApplication(
          app.id
        );

        return safeReply(
          interaction,
          '✅ You are no longer an interviewer for this application.'
        );
      }

      // ===============================================
      // START TEST NOW
      // Testing shortcut.
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'test_start_now:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (
          !app ||
          app.mode !== 'test'
        ) {
          return safeReply(
            interaction,
            '❌ Test applications only.'
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
            staff_id
          )
          VALUES(
            ?,
            ?
          )
        `).run(
          app.id,
          interaction.user.id
        );

        db.prepare(`
          UPDATE applications
          SET
            interview_ts = ?,
            timezone = 'TEST-NOW',
            status = 'confirmed'
          WHERE id = ?
        `).run(
          unixNow(),
          app.id
        );

        await confirmInterview(
          app.id,
          guild
        );

        await startInterview(
          app.id,
          guild
        );

        return safeReply(
          interaction,
          '⚡ Test interview started immediately.'
        );
      }

      // ===============================================
      // OWNER START INTERVIEW
      // ===============================================

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
          return safeReply(
            interaction,
            '❌ Only the Owner or Co-Owner can start the interview.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral,
        });

        try {
          const result =
            await startInterview(
              appId,
              guild
            );

          return interaction.editReply(
            [
              '🎙️ **Interview started.**',
              '',
              `Voice channel: ${result.voice}`,
              '',
              `Scoring channel: ${result.scoringChannel}`,
              '',
              'The applicant and interviewers were notified in the Interview Notification channel.',
            ].join('\n')
          );

        } catch (error) {
          return interaction.editReply(
            `❌ ${error.message}`
          );
        }
      }

      // ===============================================
      // CHOOSE QUESTION NUMBER
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'choose_question:'
        )
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Interview staff only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        const interviewers =
          getInterviewers(
            app.id
          );

        if (
          !interviewers.includes(
            interaction.user.id
          )
        ) {
          return safeReply(
            interaction,
            '❌ You are not one of the confirmed interviewers.'
          );
        }

        return interaction.showModal(
          questionNumberModal(
            app.id
          )
        );
      }

      // ===============================================
      // QUESTION NUMBER SUBMISSION
      // ===============================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'question_number_modal:'
        )
      ) {
        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        const raw =
          interaction.fields
            .getTextInputValue(
              'question_number'
            )
            .trim();

        if (
          !/^\d+$/.test(
            raw
          )
        ) {
          return safeReply(
            interaction,
            '❌ Enter a whole number from 1 to 21.'
          );
        }

        const number =
          Number(raw);

        if (
          number < 1 ||
          number > 21
        ) {
          return safeReply(
            interaction,
            '❌ Question number must be between 1 and 21.'
          );
        }

        const interviewers =
          getInterviewers(
            app.id
          );

        if (
          !interviewers.includes(
            interaction.user.id
          )
        ) {
          return safeReply(
            interaction,
            '❌ You are not an interviewer for this application.'
          );
        }

        const index =
          number - 1;

        const questions =
          getQuestions(
            app
          );

        if (
          !questions[index]
        ) {
          return safeReply(
            interaction,
            '❌ That interview question was not found.'
          );
        }

        db.prepare(`
          INSERT INTO score_sessions(
            app_id,
            staff_id,
            current_index,
            finished
          )
          VALUES(
            ?,
            ?,
            ?,
            0
          )

          ON CONFLICT(
            app_id,
            staff_id
          )

          DO UPDATE SET
            current_index =
              excluded.current_index
        `).run(
          app.id,
          interaction.user.id,
          index
        );

        if (
          app.mode === 'test'
        ) {
          markTestCheck(
            'typed_question'
          );
        }

        return interaction.reply({
          embeds: [
            questionEmbed(
              app,
              interaction.user.id,
              index
            ),
          ],

          components:
            questionRows(
              app,
              index
            ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // ENTER SCORE BUTTON
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'type_score:'
        )
      ) {
        const [
          ,
          appId,
          index,
        ] =
          interaction.customId
            .split(':');

        const app =
          getApplication(
            Number(
              appId
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        const interviewers =
          getInterviewers(
            app.id
          );

        if (
          !interviewers.includes(
            interaction.user.id
          )
        ) {
          return safeReply(
            interaction,
            '❌ You are not an interviewer.'
          );
        }

        return interaction.showModal(
          scoreModal(
            app.id,
            Number(
              index
            )
          )
        );
      }

      // ===============================================
      // SCORE MODAL SUBMISSION
      // ===============================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'score_modal:'
        )
      ) {
        const [
          ,
          appIdRaw,
          indexRaw,
        ] =
          interaction.customId
            .split(':');

        const appId =
          Number(
            appIdRaw
          );

        const index =
          Number(
            indexRaw
          );

        const app =
          getApplication(
            appId
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        const scoreRaw =
          interaction.fields
            .getTextInputValue(
              'score'
            )
            .trim();

        if (
          !/^[0-3]$/.test(
            scoreRaw
          )
        ) {
          return safeReply(
            interaction,
            '❌ Score must be 0, 1, 2, or 3.'
          );
        }

        const questions =
          getQuestions(
            app
          );

        const question =
          questions[index];

        if (!question) {
          return safeReply(
            interaction,
            'Question not found.'
          );
        }

        const interviewers =
          getInterviewers(
            app.id
          );

        if (
          !interviewers.includes(
            interaction.user.id
          )
        ) {
          return safeReply(
            interaction,
            '❌ You are not one of the interviewers.'
          );
        }

        const score =
          Number(
            scoreRaw
          );

        db.prepare(`
          INSERT INTO scores(
            app_id,
            staff_id,
            question_key,
            score
          )
          VALUES(
            ?,
            ?,
            ?,
            ?
          )

          ON CONFLICT(
            app_id,
            staff_id,
            question_key
          )

          DO UPDATE SET
            score =
              excluded.score
        `).run(
          app.id,
          interaction.user.id,
          question.key,
          score
        );

        if (
          app.mode === 'test'
        ) {
          markTestCheck(
            'typed_score'
          );

          markTestCheck(
            'scoring'
          );
        }

        const progress =
          interviewerScore(
            app.id,
            interaction.user.id
          );

        return interaction.reply({
          content:
            `✅ Question **${index + 1}** saved as **${score}/3**.\n\nProgress: **${progress.count}/21**`,

          embeds: [
            questionEmbed(
              app,
              interaction.user.id,
              index
            ),
          ],

          components:
            questionRows(
              app,
              index
            ),

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // VIEW PROGRESS
      // ===============================================

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
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        const progress =
          interviewerScore(
            app.id,
            interaction.user.id
          );

        const questions =
          getQuestions(
            app
          );

        const scoredRows =
          db.prepare(`
            SELECT
              question_key,
              score
            FROM scores
            WHERE app_id = ?
              AND staff_id = ?
          `).all(
            app.id,
            interaction.user.id
          );

        const scoreMap =
          new Map(
            scoredRows.map(
              row => [
                row.question_key,
                row.score,
              ]
            )
          );

        const lines =
          questions.map(
            (
              question,
              index
            ) => {
              const score =
                scoreMap.get(
                  question.key
                );

              return `${score === undefined ? '⬜' : '✅'} Question ${index + 1}: ${
                score === undefined
                  ? 'Not scored'
                  : `${score}/3`
              }`;
            }
          );

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                '📊 My Interview Scoring Progress'
              )
              .setDescription([
                `**Applicant:** <@${app.user_id}>`,
                '',
                `**Scored:** ${progress.count}/21`,
                `**Current Total:** ${progress.total}/63`,
                '',
                ...lines,
              ].join('\n')),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // ===============================================
      // FINISH MY SCORING
      // ===============================================

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
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        const interviewers =
          getInterviewers(
            app.id
          );

        if (
          !interviewers.includes(
            interaction.user.id
          )
        ) {
          return safeReply(
            interaction,
            '❌ You are not an interviewer.'
          );
        }

        const total =
          interviewerScore(
            app.id,
            interaction.user.id
          );

        if (
          total.count !== 21
        ) {
          return safeReply(
            interaction,
            `❌ You have scored **${total.count}/21** questions. Score all 21 before finishing.`
          );
        }

        db.prepare(`
          INSERT INTO score_sessions(
            app_id,
            staff_id,
            current_index,
            finished
          )
          VALUES(
            ?,
            ?,
            20,
            1
          )

          ON CONFLICT(
            app_id,
            staff_id
          )

          DO UPDATE SET
            finished = 1
        `).run(
          app.id,
          interaction.user.id
        );

        return safeReply(
          interaction,
          [
            '✅ **Your scoring is finished.**',
            '',
            `Final score: **${total.total}/63**`,
            `Percentage: **${(
              total.total /
              63 *
              100
            ).toFixed(1)}%**`,
            '',
            'Wait for the Owner or Co-Owner to end the meeting.',
          ].join('\n')
        );
      }

      // ===============================================
      // OWNER END MEETING
      // ===============================================

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
          return safeReply(
            interaction,
            '❌ Only the Owner or Co-Owner can end the meeting.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        const app =
          getApplication(
            appId
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        if (
          !allInterviewersFinished(
            app.id
          )
        ) {
          return safeReply(
            interaction,
            '❌ Every interviewer must finish all 21 scores before the meeting can end.'
          );
        }

        return interaction.reply({
          content: [
            '🏁 **End this meeting?**',
            '',
            'This will:',
            '',
            `✅ Save permanent scores in <#${INTERVIEW_RESULTS_CHANNEL_ID}>`,
            '🗑️ Delete the interview voice channel',
            '🗑️ Delete the temporary interview text channel',
            '🗑️ Delete the temporary scoring channel',
            '',
            '**Permanent scores will remain.**',
          ].join('\n'),

          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `confirm_owner_end:${app.id}`
                  )
                  .setLabel(
                    'Yes — End Meeting'
                  )
                  .setEmoji('🏁')
                  .setStyle(
                    ButtonStyle.Danger
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `cancel_owner_end:${app.id}`
                  )
                  .setLabel(
                    'Keep Meeting Open'
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
          'cancel_owner_end:'
        )
      ) {
        return interaction.update({
          content:
            '✅ Interview will continue.',

          components: [],
        });
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'confirm_owner_end:'
        )
      ) {
        if (
          !isOwnerOrCoOwner(
            member
          )
        ) {
          return safeReply(
            interaction,
            '❌ Owner or Co-Owner only.'
          );
        }

        const appId =
          Number(
            interaction.customId
              .split(':')[1]
          );

        await interaction.deferUpdate();

        try {
          await endMeeting(
            appId,
            guild
          );

          return interaction.editReply({
            content: [
              '✅ **Meeting ended.**',
              '',
              `Permanent scores were saved in <#${INTERVIEW_RESULTS_CHANNEL_ID}>.`,
              '',
              'The temporary interview channels were deleted.',
            ].join('\n'),

            components: [],
          });

        } catch (error) {
          return interaction.editReply({
            content:
              `❌ ${error.message}`,

            components: [],
          });
        }
      }

      // ===============================================
      // FINAL ACCEPT
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'final_accept:'
        )
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET status = 'accepted'
          WHERE id = ?
        `).run(
          app.id
        );

        await postApplication(
          app.id
        );

        const applicant =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(() => null);

        if (applicant) {
          await applicant
            .send(
              app.mode === 'test'
                ? '🧪 TEST RESULT: Your test application was marked accepted.'
                : '✅ Your Crafted SMP Staff Application has been accepted!'
            )
            .catch(() => null);
        }

        return safeReply(
          interaction,
          '✅ Applicant marked accepted.'
        );
      }

      // ===============================================
      // FINAL REJECT
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'final_reject:'
        )
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET status = 'rejected'
          WHERE id = ?
        `).run(
          app.id
        );

        await postApplication(
          app.id
        );

        const applicant =
          await client.users
            .fetch(
              app.user_id
            )
            .catch(() => null);

        if (applicant) {
          await applicant
            .send(
              app.mode === 'test'
                ? '🧪 TEST RESULT: Your test application was marked rejected.'
                : '❌ Your Crafted SMP Staff Application was not accepted at this time.'
            )
            .catch(() => null);
        }

        return safeReply(
          interaction,
          '❌ Applicant marked rejected.'
        );
      }

      // ===============================================
      // FURTHER REVIEW
      // ===============================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'final_review:'
        )
      ) {
        if (
          !isStaff(member)
        ) {
          return safeReply(
            interaction,
            '❌ Staff only.'
          );
        }

        const app =
          getApplication(
            Number(
              interaction.customId
                .split(':')[1]
            )
          );

        if (!app) {
          return safeReply(
            interaction,
            'Application not found.'
          );
        }

        db.prepare(`
          UPDATE applications
          SET status = 'further_review'
          WHERE id = ?
        `).run(
          app.id
        );

        await postApplication(
          app.id
        );

        return safeReply(
          interaction,
          '🟡 Applicant moved to further review.'
        );
      }

    } catch (error) {
      console.error(
        'Interaction error:',
        error
      );

      await safeReply(
        interaction,
        `❌ Something went wrong: ${error.message}`
      );
    }
  }
);

// =====================================================
// LOGIN
// =====================================================

client.login(
  DISCORD_TOKEN
);
