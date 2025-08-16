import { Router } from "express";
import { getAllPatients } from "../controllers/patient-controllers";


const router = Router();

// router.post("/", createOwner);
// router.get("/:id", getOwnerById); 
router.get("/", getAllPatients);
// router.delete("/:id", deleteOwner); 
// router.patch("/:id", updateOwner);



export default router;