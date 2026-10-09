// Mock order database array
const mockOrdersDatabase = [];

/**
 * Simulates an API call to save a newly placed order.
 * @param {Object} orderPayload - { customerId, customerName, items: [{ id, name, price, quantity }], totalAmount }
 */
export const createOrder = async (orderPayload) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const newOrder = {
        orderId: `ORD-${Math.floor(100000 + Math.random() * 900000)}`,
        status: 'PENDING',
        customerId: orderPayload.customerId,
        customerName: orderPayload.customerName,
        items: orderPayload.items,
        totalAmount: orderPayload.totalAmount,
        createdAt: new Date().toISOString(),
      };

      mockOrdersDatabase.push(newOrder);

      resolve({
        success: true,
        message: 'Order created successfully!',
        data: newOrder,
      });
    }, 600);
  });
};

export const fetchOrdersByCustomer = async (customerId) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const customerOrders = mockOrdersDatabase.filter(
        (o) => o.customerId === customerId
      );
      resolve({ success: true, data: customerOrders });
    }, 300);
  });
};