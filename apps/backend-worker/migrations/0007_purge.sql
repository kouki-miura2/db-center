-- Purging a deleted product finds its deployments (to delete their SQL in R2 first) by product, and
-- the deployments.product_id foreign key is checked when the product row goes.
CREATE INDEX deployments_product_id ON deployments (product_id);
