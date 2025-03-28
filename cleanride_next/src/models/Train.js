import mongoose from 'mongoose';

const TrainSchema = new mongoose.Schema({
  trainId: {
    type: String,
    required: true,
    unique: true,
  },
  line: {
    type: String,
    required: true,
  },
  cars: [{
    carNumber: String,
    reports: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Report',
    }],
  }],
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  currentRating: {
    type: Number,
    default: 5,
    min: 1,
    max: 5,
  },
  route: {
    type: String,
    required: true,
  },
});

export default mongoose.models.Train || mongoose.model('Train', TrainSchema);