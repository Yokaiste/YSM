use qrcodegen::{QrCode, QrCodeEcc, QrSegment, Version};
use ymb_sdk::{Context, Result, TestResult, ensure};

pub const MAX_URL_BYTES: usize = 106;
const MODULE_PIXELS: usize = 10;
const QUIET_ZONE: usize = 4;

fn symbol(url: &str) -> Result<QrCode> {
    // Version 6 keeps the fit-to-content panel within its intended screen space.
    QrCode::encode_segments_advanced(
        &[QrSegment::make_bytes(url.as_bytes())],
        QrCodeEcc::Medium,
        Version::MIN,
        Version::new(6),
        None,
        false,
    )
    .map_err(|error| {
        ymb_sdk::failure(
            format!("QR capacity exceeded: {error}."),
            "Use a URL of at most 106 UTF-8 bytes.",
        )
    })
}

fn encode(width: usize, height: usize, black: impl Fn(usize, usize) -> bool) -> Result<Vec<u8>> {
    ensure(
        width > 0 && height > 0,
        "Empty monochrome image.",
        "Provide nonempty image dimensions.",
    )?;
    let row_bytes = width.div_ceil(8);
    let length = row_bytes
        .checked_mul(height)
        .ok_or_else(|| ymb_sdk::failure("Image dimensions overflow.", "Use smaller dimensions."))?;
    let dimensions = u32::try_from(width)
        .and_then(|width| u32::try_from(height).map(|height| (width, height)))
        .map_err(|_| {
            ymb_sdk::failure(
                "Image dimensions exceed PNG limits.",
                "Use smaller dimensions.",
            )
        })?;
    let mut raw = Vec::new();
    raw.try_reserve_exact(length)
        .map_err(|error| ymb_sdk::failure(error.to_string(), "Use a smaller image."))?;
    raw.resize(length, 0u8);
    for y in 0..height {
        for x in 0..width {
            if !black(x, y) {
                raw[y * row_bytes + x / 8] |= 0x80 >> (x % 8);
            }
        }
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, dimensions.0, dimensions.1);
        encoder.set_color(png::ColorType::Grayscale);
        encoder.set_depth(png::BitDepth::One);
        encoder.set_filter(png::Filter::NoFilter);
        let mut writer = encoder.write_header().map_err(image_error)?;
        writer.write_image_data(&raw).map_err(image_error)?;
        writer.finish().map_err(image_error)?;
    }
    Ok(bytes)
}

fn image_error(error: png::EncodingError) -> Box<ymb_sdk::Diagnostic> {
    ymb_sdk::failure(
        format!("PNG encoding failed: {error}."),
        "Check the monochrome image dimensions.",
    )
}

pub fn image(url: &str) -> Result<Vec<u8>> {
    let qr = symbol(url)?;
    let size = (qr.size() as usize + 2 * QUIET_ZONE) * MODULE_PIXELS;
    encode(size, size, |x, y| {
        let x = (x / MODULE_PIXELS) as i32 - QUIET_ZONE as i32;
        let y = (y / MODULE_PIXELS) as i32 - QUIET_ZONE as i32;
        qr.get_module(x, y)
    })
}

fn check_qr() -> Result<()> {
    // Byte-mode, level-M reference vectors protect data placement across all supported versions.
    for (length, expected) in [
        (1, "0110"),
        (15, "00100000"),
        (27, "111111010000"),
        (43, "1111100111100000"),
        (63, "01100100011000100000"),
        (85, "001100111111111101010000"),
        (106, "101101101111111101000000"),
    ] {
        let qr = symbol(&"a".repeat(length))?;
        ensure(
            qr.get_module(8, 6) && qr.get_module(6, 8),
            "QR timing pattern changed.",
            "Keep standard timing marks.",
        )?;
        let edge: String = (9..qr.size() - 8)
            .map(|y| {
                let masks = [
                    y % 2 == 0,
                    y % 2 == 0,
                    true,
                    y % 3 == 0,
                    (y / 2) % 2 == 0,
                    true,
                    true,
                    y % 2 == 0,
                ];
                if qr.get_module(0, y) != masks[usize::from(qr.mask().value())] {
                    '1'
                } else {
                    '0'
                }
            })
            .collect();
        ensure(
            edge == expected,
            format!("QR data placement changed for {length} bytes."),
            "Keep byte-mode encoding and medium error correction.",
        )?;
    }
    for invalid in ["a".repeat(107), "é".repeat(54)] {
        ensure(
            symbol(&invalid).is_err(),
            "Oversized QR accepted.",
            "Keep the menu panel capacity bound.",
        )?;
    }
    Ok(())
}

fn check_png() -> Result<()> {
    let pixels = [
        [true, false, true],
        [false, true, false],
        [false, false, false],
    ];
    let bytes = encode(3, 3, |x, y| pixels[y][x])?;
    ensure(
        bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]),
        "PNG signature missing.",
        "Encode PNG bytes.",
    )?;
    let mut reader = png::Decoder::new(std::io::Cursor::new(&bytes))
        .read_info()
        .map_err(|error| ymb_sdk::failure(error.to_string(), "Keep valid PNG chunks."))?;
    let info = reader.info();
    ensure(
        info.width == 3
            && info.height == 3
            && info.bit_depth == png::BitDepth::One
            && info.color_type == png::ColorType::Grayscale,
        "PNG dimensions or bit depth changed.",
        "Keep one-bit grayscale output.",
    )?;
    let mut decoded = vec![0; reader.output_buffer_size().unwrap()];
    let frame = reader
        .next_frame(&mut decoded)
        .map_err(|error| ymb_sdk::failure(error.to_string(), "Keep valid compressed pixels."))?;
    ensure(
        decoded[..frame.buffer_size()] == [64, 160, 224],
        "PNG pixel round trip changed.",
        "Keep black and white bit packing.",
    )?;
    ensure(
        encode(3, 3, |x, y| pixels[y][x])? == bytes,
        "PNG output is nondeterministic.",
        "Keep stable image metadata.",
    )?;
    ensure(
        encode(0, 0, |_, _| false).is_err(),
        "Empty PNG accepted.",
        "Reject empty dimensions.",
    )?;
    ensure(
        encode(512, 512, |_, _| false)?.len() < 1_000,
        "Blank PNG was not compressed.",
        "Use PNG compression.",
    )?;
    Ok(())
}

pub fn qr_checks(_: &mut Context) -> Result<Vec<TestResult>> {
    check_qr()?;
    Ok(vec![TestResult::passed(
        "QR byte-mode standard placement and capacity",
    )])
}

pub fn png_checks(_: &mut Context) -> Result<Vec<TestResult>> {
    check_png()?;
    Ok(vec![TestResult::passed(
        "One-bit PNG pixels, dimensions, compression, and determinism",
    )])
}

#[test]
fn qr_standard_vectors() {
    check_qr().unwrap();
}

#[test]
fn png_round_trip() {
    check_png().unwrap();
}
