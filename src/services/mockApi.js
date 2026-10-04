const mockUsers = [
  {
    id: "101",
    username: "sperson",
    password: "salesperson123",
    firstName: "Juan",
    lastName: "Dela Cruz",
    phone: "+639123456789",
    birthdate: "1990-05-14",
    role: "SalesPerson",
    roleId: "ROLE_SALES_02"
  }
];

export const loginUser = async (username, password) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const user = mockUsers.find(
        (u) => u.username === username && u.password === password
      );
      if (user) {
        const { password, ...userData } = user;
        resolve({ success: true, data: userData });
      } else {
        reject({ success: false, message: "Invalid username or password" });
      }
    }, 1000);
  });
};