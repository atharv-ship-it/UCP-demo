import {getProductsDb} from './db';

/**
 * Represents a product in the catalog.
 */
export interface Product {
  id: string;
  title: string;
  price: number; // Price in cents
  image_url: string | undefined;
  series: string;
  description: string;
  seer: number | null;
  seer2: number | null;
  noise: number | null;
  energy_star: number; // SQLite uses INTEGER for boolean (0 or 1)
  rating: number;
  reviews: number;
  price_display: string;
  price_dollars: string;
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
    'SELECT id, title, price, image_url, series, description, seer, seer2, noise, energy_star, rating, reviews, price_display, price_dollars FROM products WHERE id = ?',
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
  const stmt = db.prepare('SELECT id, title, price, image_url, series, description, seer, seer2, noise, energy_star, rating, reviews, price_display, price_dollars FROM products');
  return stmt.all() as Product[];
}
