const mockProductsData = [
  {
    id: "e9b21f37-142c-4f76-96f3-a3d8b02e7b91",
    name: "Butane Canister 250g",
    category: "Canister",
    containerType: "CANISTER",
    netWeightKg: 0.25,
    price: 100.00,
    isActive: true,
    createdAt: "2026-08-28T12:20:00.000Z",
    updatedAt: "2026-08-28T12:20:00.000Z",
  },
  {
    id: "27d6365b-bfb0-4ca7-b286-63d1bcfa2520",
    name: "11kg LPG Cylinder",
    category: "LPG Cylinder",
    containerType: "CYLINDER",
    netWeightKg: 11.0,
    price: 1000.00,
    isActive: true,
    createdAt: "2026-08-28T12:20:00.000Z",
    updatedAt: "2026-08-28T12:20:00.000Z",
  },
  {
    id: "84fc2e10-c4a1-4328-98e3-509f6e6f1f44",
    name: "22kg LPG Cylinder",
    category: "LPG Cylinder",
    containerType: "CYLINDER",
    netWeightKg: 22.0,
    price: 2000.00,
    isActive: true,
    createdAt: "2026-08-28T12:20:00.000Z",
    updatedAt: "2026-08-28T12:20:00.000Z",
  },
  {
    id: "8f4a2c91-7d63-4b0e-a825-19c6f3d70e42",
    name: "22kg LPG Cylinder",
    category: "LPG Cylinder",
    containerType: "CYLINDER",
    netWeightKg: 22.0,
    price: 2000.00,
    isActive: true,
    createdAt: "2026-08-28T12:20:00.000Z",
    updatedAt: "2026-08-28T12:20:00.000Z",
  },
  {
    id: "c3b7e915-2a48-46df-9b01-7e5d82a4f630",
    name: "11kg LPG Cylinder",
    category: "LPG Cylinder",
    containerType: "CYLINDER",
    netWeightKg: 11.0,
    price: 1000.00,
    isActive: true,
    createdAt: "2026-08-28T12:20:00.000Z",
    updatedAt: "2026-08-28T12:20:00.000Z",
  },
  {
    id: "5d9e1a74-f286-4c3b-8a51-62b0d7e943fc",
    name: "22kg LPG Cylinder",
    category: "LPG Cylinder",
    containerType: "CYLINDER",
    netWeightKg: 22.0,
    price: 2000.00,
    isActive: true,
    createdAt: "2026-08-28T12:20:00.000Z",
    updatedAt: "2026-08-28T12:20:00.000Z",
  },
];

export const fetchProducts = async () => {
  return new Promise((resolve) => {
    setTimeout(() => resolve(mockProductsData), 150);
  });
};