const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patientController');
const { verifyToken, requirePermission } = require('../middleware/authMiddleware');

router.use(verifyToken, requirePermission('manage_patients'));

// CRUD routes
router.get('/', patientController.getPatients);
router.get('/:id', patientController.getPatientById);
router.post('/', patientController.createPatient);
router.put('/:id', patientController.updatePatient);
router.delete('/:id', patientController.deletePatient);

module.exports = router;