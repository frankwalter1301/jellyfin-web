const path = require("path");
const common = require("./webpack.common");
const merge = require("webpack-merge");

module.exports = merge(common, {
    mode: "production",
    output: {
        filename: "bundle.js",
        path: path.resolve(__dirname, "dist"),
        libraryTarget: "amd-require"
    },
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ["style-loader", "css-loader", 'sass-loader']
            },
            {
                test: /\.(png|jpg|gif)$/i,
                use: ["file-loader"]
            }
        ]
    },
});
