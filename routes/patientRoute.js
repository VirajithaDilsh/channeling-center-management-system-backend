const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patientController');
const { verifyToken, requirePermission } = require('../middleware/authMiddleware');

router.use(verifyToken);

// CRUD routes
// doctor_portal alone only lists / reaches patients the caller is actually
// treating — scoped in the controller via doctorIdentityService.
router.get('/', requirePermission('patients_read', 'patients_allow_all', 'doctor_portal'), patientController.getPatients);
router.get('/:id', requirePermission('patients_read', 'patients_allow_all', 'doctor_portal'), patientController.getPatientById);
router.post('/', requirePermission('patients_write', 'patients_allow_all'), patientController.createPatient);
router.put('/:id', requirePermission('patients_edit', 'patients_allow_all'), patientController.updatePatient);
router.delete('/:id', requirePermission('patients_edit', 'patients_allow_all'), patientController.deletePatient);

module.exports = router;