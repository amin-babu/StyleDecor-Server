const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT || 3000;
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const crypto = require("crypto");

function generateTrackingId() {
  const prefix = "STDR";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${date}-${random}`;
}

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qyacehm.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

app.get('/', (req, res) => {
  res.send('StyleDcor Server is Running')
});

async function run() {
  try {
    await client.connect();

    const db = client.db('StyleDecorDB');
    const servicesCollection = db.collection('services');
    const bookingCollection = db.collection('bookings');
    const paymentCollection = db.collection('payments');


    // service related API
    app.get('/services/home', async (req, res) => {
      const result = await servicesCollection.find().limit(8).toArray();
      res.send(result);
    });

    app.get('/services', async (req, res) => {
      const result = await servicesCollection.find().toArray();
      res.send(result);
    });

    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });

    // booking
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    app.get('/bookings', async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }
        const query = { userEmail: email };
        const bookings = await bookingCollection.find(query).toArray();
        res.send(bookings);
      } catch (error) {
        res.status(500).send({ message: 'Failed to get bookings' });
      }
    });

    app.delete('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.deleteOne(query);
      res.send(result);
    });

    // peyment related APIs
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.servicePrice) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'BDT',
              product_data: {
                name: `Please pay for ${paymentInfo.serviceName}`,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.userEmail,
        mode: 'payment',
        metadata: {
          bookingId: paymentInfo.bookingId,
          serviceName: paymentInfo.serviceName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log('session retrieve', session);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };

      const paymentExist = await paymentCollection.findOne(query);
      console.log(paymentExist);

      if (paymentExist) {
        return res.send({
          message: 'Already Exist',
          transactionId,
          trackingId: paymentExist.trackingId
        });
      };

      const trackingId = generateTrackingId();

      if (session.payment_status === 'paid') {
        const id = session.metadata.bookingId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            status: 'success',
            paid: true,
            trackingId: trackingId
          }
        };
        const result = await bookingCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          bookingId: session.metadata.bookingId,
          serviceName: session.metadata.serviceName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId
        };

        if (session.payment_status === 'paid') {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: resultPayment,
            trackingId: trackingId,
            transactionId: session.payment_intent
          });
        };
      }
      // res.send({ success: false });
    });

    app.get('/payments', async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email
      };
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`StyleDcor Server is Running on port ${port}`)
});
