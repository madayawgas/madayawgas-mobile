const mockCustomersData = {
  "status": "success",
  "data": {
    "count": 6,
    "customers": [
      {
        "id": "1",
        "name": "Leshka Karenderia",
        "address": "Jerome, Agdao, Davao City",
        "contactNumber": "+(63) 999 9999 994",
        "customerType": "COMMERCIAL",
        "isActive": true,
        "createdAt": "2026-10-06T14:40:00.000Z"
      },
      {
        "id": "2",
        "name": "Precious Gasoline",
        "address": "Matina Aplaya, Talomo, Davao City",
        "contactNumber": "+(63) 999 9999 995",
        "customerType": "COMMERCIAL",
        "isActive": true,
        "createdAt": "2026-09-18T14:00:00.000Z"
      },
      {
        "id": "3",
        "name": "Berning Station",
        "address": "Corner San Pedro St, Davao City",
        "contactNumber": "+(63) 999 9999 9996",
        "customerType": "COMMERCIAL",
        "isActive": true,
        "createdAt": "2026-10-08T14:40:00.000Z"
      },
      {
        "id": "4",
        "name": "Sofia Gas Station",
        "address": "123 Mabini St., Poblacion, Davao City",
        "contactNumber": "+(63) 999 9999 997",
        "customerType": "RETAIL",
        "isActive": true,
        "createdAt": "2026-10-06T14:00:00.000Z"
      },
      {
        "id": "5",
        "name": "Jollabee Bahada",
        "address": "J.P. Laurel Ave, Bajada, Davao City",
        "contactNumber": "+(63) 999 9999 998",
        "customerType": "COMMERCIAL",
        "isActive": true,
        "createdAt": "2021-10-09T08:00:00.000Z"
      }
    ]
  }
};

export const fetchCustomers = async () => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(mockCustomersData);
    }, 200);
  });
};