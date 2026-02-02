import {getProductsDb} from './db';

/**
 * Represents a product in the catalog.
 * Note: price is for internal UCP checkout, price_display is the official Lennox price guide ($/$$/$$$/$$$) for display
 */
export interface Product {
  id: string;
  title: string;
  price: number; // Internal price for UCP checkout (in cents)
  image_url: string | undefined;
  series: string;
  description: string;
  seer: number | null;
  seer2: number | null;
  eer2: number | null;
  noise: number | null;
  energy_star: number; // SQLite uses INTEGER for boolean (0 or 1)
  rating: number;
  reviews: number;
  price_display: string; // Official price guide: $, $$, $$$, $$$$
  refrigerant_type: string | null;
  compressor_type: string | null;
  compressor_stages: string | null;
  features: string | null; // JSON array stored as string
  warranty_compressor_years: number | null;
  warranty_parts_years: number | null;
  status: string | null;
  regional_availability: string | null;
  url: string | null;
}

/**
 * Retrieves a product from the database by its ID.
 *
 * @param productId The unique identifier of the product.
 * @returns The Product object if found, otherwise undefined.
 */
export function getProduct(productId: string): Product | undefined {
  const db = getProductsDb();
  const stmt = db.prepare(
    'SELECT id, title, price, image_url, series, description, seer, seer2, eer2, noise, energy_star, rating, reviews, price_display, refrigerant_type, compressor_type, compressor_stages, features, warranty_compressor_years, warranty_parts_years, status, regional_availability, url FROM products WHERE id = ?',
  );
  const result = stmt.get(productId) as Product | undefined;
  return result;
}

/**
 * Retrieves all products from the database.
 *
 * @returns Array of all products.
 */
export function getAllProducts(): Product[] {
  const db = getProductsDb();
  const stmt = db.prepare('SELECT id, title, price, image_url, series, description, seer, seer2, eer2, noise, energy_star, rating, reviews, price_display, refrigerant_type, compressor_type, compressor_stages, features, warranty_compressor_years, warranty_parts_years, status, regional_availability, url FROM products');
  return stmt.all() as Product[];
}
