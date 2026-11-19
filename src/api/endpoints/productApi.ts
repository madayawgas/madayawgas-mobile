import { apiClient } from '../client';
import { ProductCatalogItem } from '@/types';

export const productApi = {
  async fetchProductCatalog(): Promise<ProductCatalogItem[]> {
    const res = await apiClient<any>('/inventory/products', {
      method: 'GET',
    });
    const rawList = Array.isArray(res.data)
      ? res.data
      : (Array.isArray(res.data?.products) ? res.data.products : []);
    return rawList.map((p: any) => {
      const unitPrice = Number(p.unitPrice ?? p.unit_price ?? p.price ?? 0);
      return {
        ...p,
        netWeightKg: Number(p.netWeightKg ?? p.net_weight_kg ?? 0),
        unitPrice,
        price: unitPrice,
      };
    });
  },
};
