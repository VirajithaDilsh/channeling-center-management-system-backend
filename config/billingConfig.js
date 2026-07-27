// Flat center fee applied to every channeling booking, on top of the doctor's fee.
const CENTER_FEE = Number(process.env.CENTER_FEE) || 300;

module.exports = { CENTER_FEE };
