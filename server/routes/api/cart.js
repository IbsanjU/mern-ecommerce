const express = require('express');
const router = express.Router();

// Bring in Models & Utils
const Cart = require('../../models/cart');
const Product = require('../../models/product');
const auth = require('../../middleware/auth');
const store = require('../../utils/store');

router.post('/add', auth, async (req, res) => {
  const reserved = [];

  try {
    const user = req.user._id;
    const items = req.body.products;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    const lines = [];

    for (const item of items) {
      const quantity = Number(item.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new CheckoutError('Invalid product quantity.');
      }

      // Price and tax flag always come from the database, never the client
      const product = await Product.findOne({
        _id: item.product,
        isActive: true
      });

      if (!product) {
        throw new CheckoutError('A product in your cart is unavailable.');
      }

      // Atomic reservation: only succeeds while enough stock remains
      const result = await Product.updateOne(
        { _id: product._id, quantity: { $gte: quantity } },
        { $inc: { quantity: -quantity } }
      );

      if (result.nModified !== 1) {
        throw new CheckoutError(
          `Not enough stock for ${product.name}. Please update your cart.`
        );
      }

      reserved.push({ product: product._id, quantity });
      lines.push({
        product: product._id,
        quantity,
        price: product.price,
        taxable: product.taxable
      });
    }

    const products = store.caculateItemsSalesTax(lines);
    const cartDoc = await new Cart({ user, products }).save();

    res.status(200).json({
      success: true,
      cartId: cartDoc.id
    });
  } catch (error) {
    await releaseStock(reserved);

    if (error instanceof CheckoutError) {
      return res.status(400).json({ error: error.message });
    }

    res.status(400).json({
      error: 'Your request could not be processed. Please try again.'
    });
  }
});

router.delete('/delete/:cartId', auth, async (req, res) => {
  try {
    await Cart.deleteOne({ _id: req.params.cartId });

    res.status(200).json({
      success: true
    });
  } catch (error) {
    res.status(400).json({
      error: 'Your request could not be processed. Please try again.'
    });
  }
});

router.post('/add/:cartId', auth, async (req, res) => {
  try {
    const product = req.body.product;
    const query = { _id: req.params.cartId };

    await Cart.updateOne(query, { $push: { products: product } }).exec();

    res.status(200).json({
      success: true
    });
  } catch (error) {
    res.status(400).json({
      error: 'Your request could not be processed. Please try again.'
    });
  }
});

router.delete('/delete/:cartId/:productId', auth, async (req, res) => {
  try {
    const product = { product: req.params.productId };
    const query = { _id: req.params.cartId };

    await Cart.updateOne(query, { $pull: { products: product } }).exec();

    res.status(200).json({
      success: true
    });
  } catch (error) {
    res.status(400).json({
      error: 'Your request could not be processed. Please try again.'
    });
  }
});

class CheckoutError extends Error {}

// Give back stock reserved for a checkout that did not complete
const releaseStock = async reserved => {
  if (reserved.length === 0) return;

  await Product.bulkWrite(
    reserved.map(item => ({
      updateOne: {
        filter: { _id: item.product },
        update: { $inc: { quantity: item.quantity } }
      }
    }))
  );
};

module.exports = router;
