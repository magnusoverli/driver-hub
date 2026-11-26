import { Images } from './images.js';
import { distributionServer } from './distribution.js';

if (!process.env.DRIVER_HUB_IMAGES_DIR) throw new Error('Set DRIVER_HUB_IMAGES_DIR to the published image directory');
distributionServer(new Images(process.env.DRIVER_HUB_IMAGES_DIR)).listen(
  Number(process.env.PORT ?? 5000), process.env.HOST ?? '127.0.0.1'
);
