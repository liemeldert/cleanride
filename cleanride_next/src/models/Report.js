import mongoose from 'mongoose';

const ReportSchema = new mongoose.Schema({
  trainId: {
    type: String,
    required: true,
  },
  carNumber: {
    type: String,
    required: true,
  },
  reportType: {
    type: String,
    required: true,
    enum: ['CLEANLINESS', 'MAINTENANCE', 'SAFETY', 'COMFORT', 'OTHER'],
  },
  description: {
    type: String,
    default: '',
  },
  severity: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  isUrgent: {
    type: Boolean,
    default: false,
  },
  location: {
    latitude: Number,
    longitude: Number,
  },
  status: {
    type: String,
    default: 'OPEN',
    enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Report || mongoose.model('Report', ReportSchema);
