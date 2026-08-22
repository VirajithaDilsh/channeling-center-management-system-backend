const SystemSettings = require("../models/SystemSettings");

const PAYMENT_METHODS = ["cash", "card", "insurance"];

// Non-sensitive fields needed pre-login (Login page branding) and by every
// authenticated role regardless of the "settings" permission (e.g. billing
// staff need the currency symbol and enabled payment methods).
exports.getPublicSettings = async (req, res) => {
  try {
    const s = await SystemSettings.getSingleton();
    res.json({
      centerName: s.general.centerName,
      logoUrl: s.general.logoUrl,
      contactNumber: s.general.contactNumber,
      currencySymbol: s.payments.currencySymbol,
      enabledPaymentMethods: s.payments.enabledPaymentMethods,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const s = await SystemSettings.getSingleton();
    res.json(s);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

function validateSection(body) {
  const { general, appointments, payments, doctorDefaults } = body;

  if (appointments) {
    const { defaultDurationMinutes, maxAdvanceBookingDays, cancellationWindowHours } = appointments;
    if (defaultDurationMinutes !== undefined && !(defaultDurationMinutes >= 5)) {
      return "Default appointment duration must be at least 5 minutes";
    }
    if (maxAdvanceBookingDays !== undefined && !(maxAdvanceBookingDays >= 1)) {
      return "Maximum advance booking period must be at least 1 day";
    }
    if (cancellationWindowHours !== undefined && !(cancellationWindowHours >= 0)) {
      return "Cancellation window cannot be negative";
    }
  }

  if (payments) {
    const { centerFee, enabledPaymentMethods, currencySymbol } = payments;
    if (centerFee !== undefined && !(centerFee >= 0)) {
      return "Center fee cannot be negative";
    }
    if (enabledPaymentMethods !== undefined) {
      if (!Array.isArray(enabledPaymentMethods) || enabledPaymentMethods.length === 0) {
        return "At least one payment method must be enabled";
      }
      if (enabledPaymentMethods.some((m) => !PAYMENT_METHODS.includes(m))) {
        return `Payment methods must be one of: ${PAYMENT_METHODS.join(", ")}`;
      }
    }
    if (currencySymbol !== undefined && !currencySymbol.trim()) {
      return "Currency symbol cannot be empty";
    }
  }

  if (doctorDefaults) {
    const { defaultConsultationDurationMinutes } = doctorDefaults;
    if (defaultConsultationDurationMinutes !== undefined && !(defaultConsultationDurationMinutes >= 5)) {
      return "Default consultation duration must be at least 5 minutes";
    }
  }

  if (general && general.email !== undefined && general.email && !/^\S+@\S+\.\S+$/.test(general.email)) {
    return "General contact email is invalid";
  }

  return null;
}

exports.updateSettings = async (req, res) => {
  try {
    const error = validateSection(req.body);
    if (error) return res.status(400).json({ message: error });

    const s = await SystemSettings.getSingleton();
    const { general, appointments, payments, doctorDefaults } = req.body;

    if (general) Object.assign(s.general, general);
    if (appointments) Object.assign(s.appointments, appointments);
    if (payments) Object.assign(s.payments, payments);
    if (doctorDefaults) Object.assign(s.doctorDefaults, doctorDefaults);
    s.updatedBy = req.user?.name;

    await s.save();
    res.json(s);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
