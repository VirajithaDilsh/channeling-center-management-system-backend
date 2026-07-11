const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminSchema = new mongoose.Schema({

  adminId: {
    type: String,
    required: true,
    unique: true
  },

  name: {
    type: String,
    required: true
  },

  email: {
    type: String,
    required: true,
    unique: true
  },

  role: {
    type: String,
    required: true
  },

  contact: {
    type: String
  },

  password: {
    type: String,
    required: true
  }

}, { timestamps: true });

async function hashPasswordIfPresent(update) {
  if (!update || !update.password) return;
  update.password = await bcrypt.hash(update.password, 10);
}

adminSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

adminSchema.pre("findOneAndUpdate", async function () {
  await hashPasswordIfPresent(this.getUpdate());
});

adminSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("Admin", adminSchema);
