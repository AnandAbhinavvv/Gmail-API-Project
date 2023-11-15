require('dotenv').config();
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const {
  google
} = require('googleapis');
const {
  OAuth2Client
} = require('google-auth-library');

const app = express();

app.use(require('express-session')({
  secret: 'your-secret-key',
  resave: true,
  saveUninitialized: true
}));

app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
  },
  (accessToken, refreshToken, profile, done) => {
    return done(null, {
      profile,
      accessToken,
      refreshToken
    });
  }
));

app.use(passport.initialize());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

app.get('/', (req, res) => {
  res.send('Welcome to the landing page. <a href="/auth/google">Login with Google</a>');
});

app.get('/auth/google',
  passport.authenticate('google', {
    scope: ['https://www.googleapis.com/auth/plus.login', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.send']
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/'
  }),
  (req, res) => {
    res.redirect('/mailreply');
  }
);


const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};


function makeBody(ref, InReply, to, from, subject, message) {
  var str = ["Content-Type: text/plain; charset=\"UTF-8\"\n",
    "MIME-Version: 1.0\n",
    "Content-Transfer-Encoding: 7bit\n",
    "References:", ref, "\n" +
    "In-Reply-To: ", InReply, "\n" +
    "to: ", to, "\n",
    "from: ", from, "\n",
    "subject: ", subject, "\n\n",
    message
  ].join('');

  console.log(str);

  var encodedMail = Buffer.from(str).toString("base64").replace(/\+/g, '-').replace(/\//g, '_');
  return encodedMail
}

app.get('/mailreply', ensureAuthenticated, async (req, res) => {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken,
    });

    const gmail = google.gmail({
      version: 'v1',
      auth: oauth2Client
    });

    //It will gather the sent mail id & thread id, with the help of documentations
    const response1 = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["SENT"]
    });

    const mailSent = response1.data.messages;
    
    
    //It will gather the inbox mail id & thread id, with the help of documentations
    const response2 = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"]
    });

    let mailRecieved = response2.data.messages;

    //Making list of threadId
    const arrayOfThreads = mailRecieved.map(mail => {
      return mail.threadId;
    })

    let threadsRvd = new Set(arrayOfThreads);

    //Filtering out those mail's thread that have never been attended/replied
    for (let i = 0; i < mailSent.length; i++) {
      const mail = mailSent[i];
      if (threadsRvd.has(mail.threadId)) {
        mailRecieved = mailRecieved.filter(mailrvd => mailrvd.threadId !== mail.threadId);
      }
    }

    //Fetching the entire messages from message ids and sending the reply
    for (let i = 0; i < mailRecieved.length; i++) {
      const mail = mailRecieved[i];
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: mail.id
      });

      const headers = msg.data.payload.headers;

      let subject = ""
      let to = ""
      let ref = ""
      let InReply = "";

      //Extracting the nessary data from the previously stored data i.e. subject, to, etc.
      headers.forEach(element => {
        if (element.name === 'Subject' || element.name === 'subject') {
          subject = element.value
        }
        if (element.name === 'From' || element.name === 'from') {
          to = element.value
        }
        if (element.name === 'Message-ID' || element.name === 'Message-Id') {
          ref = element.value
          InReply = element.value
        }
      });
      var raw = makeBody(ref, InReply, to, 'roasteranand@gmail.com', subject, 'This is the Reply Message');

      //Sending the reply mail from here
      await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: raw,
          threadId: mailRecieved.threadId
        }
      })
    }

    console.log(mailRecieved.length);
    res.send(mailRecieved);

  } catch (error) {
    console.error('Error retrieving Gmail mail:', error);
    res.status(500).send('Error retrieving Gmail mail');
  }
});

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});